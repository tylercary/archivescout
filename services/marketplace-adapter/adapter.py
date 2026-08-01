#!/usr/bin/env python3
"""
ArchiveScout marketplace feed adapter
=====================================

A small, standalone HTTP service that speaks the exact "partner feed" contract
ArchiveScout consumes (see lib/marketplaces/schemas.ts). It is the ISOLATED
boundary where a real data source lives, so the Next.js app itself never talks
to any marketplace directly and stays ToS-clean — it only fetches a feed URL.

Endpoints (Bearer-authenticated):
    GET /grailed?query=<q>&page=1&hits_per_page=24&price_min=&price_max=
        -> { "listings": [ <grailed raw item>, ... ], "total": N, "page": P }
    GET /grailed/<id>    -> a single raw item (or 404)

Grailed data comes from the `grailed_api` PyPI library
(`pip install grailed_api`). See search_grailed_live() / map_grailed_live().

⚠️  PERSONAL / LOCAL USE, ToS NOTICE
    Grailed has no official public search API. The `grailed_api` library
    reaches Grailed's private endpoints without authorization, which is contrary
    to Grailed's Terms of Service. Running this is a personal-use choice you
    own: expect blocking/rate-limits and breakage when endpoints change, and do
    not use it for a public or commercial deployment.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", "8787"))
API_KEY = os.environ.get("ADAPTER_API_KEY", "")  # if set, Bearer must match
# Verbose per-request diagnostics (nbHits/nbPages, raw sample product).
ADAPTER_DEBUG = os.environ.get("ADAPTER_DEBUG", "").lower() in ("1", "true", "yes")

# Set after the first live product is logged (see search_grailed_live).
_LOGGED_GRAILED_SAMPLE = False


# ─────────────────────────── helpers ───────────────────────────
# ─────────────────────────── source: Grailed ───────────────────────────
def get_grailed_item(item_id):
    """
    Single item by id, via the SAME Algolia search index the list endpoint
    uses (an `id=` numeric filter) — Grailed's per-listing endpoint sits
    behind bot protection and is not used. Returns a mapped raw item or None.
    """
    import re as _re
    from grailed_api.enums import Departments
    from grailed_api.services.products_list_service import ProductsListService

    svc = ProductsListService()
    for dept in (Departments.MENSWEAR, Departments.WOMENSWEAR):
        params = svc.create_params_string(
            (), (), (), (), (), (), svc.get_all_facets(), dept,
            False, 1, 10, 0, 1_000_000, 0, "",
        )
        params = _re.sub(r"numericFilters=[^&]*", f'numericFilters=["id={int(item_id)}"]', params)
        payload = {"requests": svc.get_payload_requests(False, True, params)}
        body = svc.send_request(payload, False).json()
        results = body.get("results") or []
        hits = (results[0].get("hits") if results else None) or []
        if hits:
            return map_grailed_live(hits[0])
    return None


def search_grailed(query, page, limit, price_min, price_max, filters=None):
    filters = filters or {}
    # Source-paged + source-filtered: fetch exactly page `page` of `limit`.
    items, meta = search_grailed_live(
        query, page, limit, price_min, price_max,
        designers=filters.get("designers"),
        categories=filters.get("categories"),
        conditions=filters.get("conditions"),
        department=filters.get("department"),
        sizes=filters.get("sizes"),
        locations=filters.get("locations"),
    )
    # NEVER fabricate a total. When the source doesn't report nbHits we return
    # null, and the app shows "N matching listings loaded" instead of an
    # invented "N of ~M".
    return {
        "listings": items,
        "total": meta.get("total"),
        "page": page,
        "nbPages": meta.get("nbPages"),
        # Facet counts across the WHOLE result set (not just this page), so the
        # sidebar can offer every real option on a broad search.
        "facets": meta.get("facets"),
    }


# Cached translation tables from the app's filter strings -> grailed_api enums.
_GRAILED_ENUMS = None


def _grailed_enum_tables():
    """Build (once) lookups from the app's filter strings to library enums.
    Reads the library's own enum definitions so names never drift."""
    global _GRAILED_ENUMS
    if _GRAILED_ENUMS is not None:
        return _GRAILED_ENUMS

    from grailed_api.enums import Conditions, Departments
    from grailed_api.enums import categories as C

    conditions = {
        "new with tags": Conditions.IS_NEW,
        "new without tags": Conditions.IS_NEW,  # library has no separate NWT
        "excellent": Conditions.IS_GENTLY_USED,
        "good": Conditions.IS_USED,
        "fair": Conditions.IS_WORN,
    }
    departments = {
        "menswear": Departments.MENSWEAR,
        "womenswear": Departments.WOMENSWEAR,
    }

    # category member name (prettified/lowercased) -> enum member
    classes = [C.Tops, C.Bottoms, C.Outerwear, C.Tailoring, C.Footwear, C.Accessories]
    cat_lookup = {}
    for cls in classes:
        for name in dir(cls):
            if name.startswith("_") or not name.isupper():
                continue
            cat_lookup[name.replace("_", " ").lower()] = getattr(cls, name)

    # human synonyms -> one or more enum members
    synonyms = {
        "sneakers": [C.Footwear.LOWTOP_SNEAKERS, C.Footwear.HITOP_SNEAKERS],
        "sneaker": [C.Footwear.LOWTOP_SNEAKERS, C.Footwear.HITOP_SNEAKERS],
        "runners": [C.Footwear.LOWTOP_SNEAKERS],
        "shoes": [C.Footwear.LOWTOP_SNEAKERS, C.Footwear.HITOP_SNEAKERS, C.Footwear.BOOTS],
        "footwear": [getattr(C.Footwear, n) for n in dir(C.Footwear) if n.isupper()],
        "boots": [C.Footwear.BOOTS],
        "jeans": [C.Bottoms.DENIM],
        "denim": [C.Bottoms.DENIM],
        "pants": [C.Bottoms.CASUAL_PANTS],
        "trousers": [C.Bottoms.CASUAL_PANTS],
        "shorts": [C.Bottoms.SHORTS],
        "hoodie": [C.Tops.SWEATSHIRTS],
        "hoodies": [C.Tops.SWEATSHIRTS],
        "sweatshirt": [C.Tops.SWEATSHIRTS],
        "sweater": [C.Tops.SWEATERS_KNITWEAR],
        "sweaters": [C.Tops.SWEATERS_KNITWEAR],
        "knitwear": [C.Tops.SWEATERS_KNITWEAR],
        "shirt": [C.Tops.BUTTON_UPS, C.Tops.SHORT_SLEEVE_SHIRTS, C.Tops.LONG_SLEEVE_SHIRTS],
        "tee": [C.Tops.SHORT_SLEEVE_SHIRTS],
        "t shirts": [C.Tops.SHORT_SLEEVE_SHIRTS],
        "jacket": [C.Outerwear.LIGHT_JACKETS, C.Outerwear.LEATHER_JACKETS, C.Outerwear.DENIM_JACKETS],
        "jackets": [C.Outerwear.LIGHT_JACKETS, C.Outerwear.LEATHER_JACKETS, C.Outerwear.DENIM_JACKETS],
        "coat": [C.Outerwear.HEAVY_COATS],
        "coats": [C.Outerwear.HEAVY_COATS],
        "bag": [C.Accessories.BAGS_LUGGAGE],
        "bags": [C.Accessories.BAGS_LUGGAGE],
        "wallet": [C.Accessories.WALLETS],
        "wallets": [C.Accessories.WALLETS],
        "accessories": [getattr(C.Accessories, n) for n in dir(C.Accessories) if n.isupper()],
    }

    _GRAILED_ENUMS = (conditions, departments, cat_lookup, synonyms)
    return _GRAILED_ENUMS


def _map_categories(values):
    """App category strings -> a de-duplicated list of library category enums."""
    _, _, cat_lookup, synonyms = _grailed_enum_tables()
    out, seen = [], set()
    for v in values or []:
        key = str(v).strip().lower()
        members = []
        if key in cat_lookup:
            members = [cat_lookup[key]]
        elif key in synonyms:
            members = synonyms[key]
        else:
            # last resort: substring match against known member names
            for name, member in cat_lookup.items():
                if key and (key in name or name in key):
                    members.append(member)
        for m in members:
            if id(m) not in seen:
                seen.add(id(m))
                out.append(m)
    return out


_SIZE_PREFIXES = ("accessories", "bottoms", "footwear", "outerwear", "tailoring", "tops")


def _grailed_size_facets(sizes, category_enums):
    """
    App size strings -> Grailed `category_size` facet values.

    Confirmed format (library size enums + captured live payloads):
        "34"       -> bottoms.34 / accessories.34 / ...
        "10.5"     -> footwear.10.5
        "m"        -> tops.m / outerwear.m
        "one size" -> accessories.one_size (live index) and accessories.os
                      (library enum) — both variants are emitted since sources
                      disagree; the group is OR'ed so extras are harmless.

    When categories are selected, prefixes are narrowed to those categories'
    top levels; otherwise all six are emitted (the size group ANDs with the
    category group, so non-existent combos match nothing).
    """
    if category_enums:
        prefixes = sorted({c.value.split(".")[0] for c in category_enums})
    else:
        prefixes = list(_SIZE_PREFIXES)

    # Sizes may arrive typed ("footwear:13" / "waist:34" / "clothing:l") from
    # the app's grouped size UI. A typed size scopes to its garment family so
    # "13 the shoe" never also matches size-13 tops. Bare values keep the
    # all-family behavior.
    type_prefixes = {
        "footwear": ["footwear"],
        "waist": ["bottoms"],
        "clothing": ["tops", "outerwear", "tailoring", "accessories"],
    }

    out = []
    for s in sizes or ():
        norm = str(s).strip().lower()
        if not norm:
            continue
        size_type, _, rest = norm.partition(":")
        if rest and size_type in type_prefixes:
            norm = rest
            scoped = type_prefixes[size_type]
            # Respect an active category narrowing when compatible.
            use = [p for p in scoped if p in prefixes] or scoped
        else:
            use = prefixes
        variants = {norm.replace(" ", "_"), norm.replace(" ", "")}
        for prefix in use:
            for v in variants:
                out.append(f"{prefix}.{v}")
    return out


def search_grailed_live(query, page=1, limit=40, price_min=None, price_max=None,
                        designers=None, categories=None, conditions=None, department=None,
                        sizes=None, locations=None):
    """
    Calls the community `grailed_api` library (pip install grailed_api) and maps
    its product objects into the raw feed shape ArchiveScout expects.

    NOTE: the exact keys `find_products()` returns can change with Grailed's
    backend. Run once, inspect a printed raw item (see below), and adjust
    map_grailed_live() to match. This function is the ONLY place the unauthorized
    source is touched.
    """
    try:
        from grailed_api.services import ProductsListService  # type: ignore
        from grailed_api.enums import Departments  # type: ignore
    except ImportError:
        raise RuntimeError(
            "The adapter requires the grailed_api package: pip install grailed_api"
        )

    # Translate the app's active filters into Grailed's typed query params.
    cats = _map_categories(categories) if categories else []
    conds = []
    if conditions:
        cond_map = _grailed_enum_tables()[0]
        conds = [cond_map[c.lower()] for c in conditions if c.lower() in cond_map]

    # Locations are a first-class Grailed facet; values match our labels 1:1.
    locs = []
    if locations:
        from grailed_api.enums import Locations
        by_value = {m.value.lower(): m for m in Locations}
        locs = [by_value[l.lower()] for l in locations if l.lower() in by_value]

    # Grailed requires exactly one department per query. When the app doesn't
    # pin one, search BOTH departments and merge (the library alone defaults to
    # menswear-only, which silently hides womenswear results).
    if department:
        dept_map = _grailed_enum_tables()[1]
        d = dept_map.get(str(department).lower())
        departments = [d] if d is not None else [Departments.MENSWEAR, Departments.WOMENSWEAR]
    else:
        departments = [Departments.MENSWEAR, Departments.WOMENSWEAR]

    # Use the library's own service layer directly (same request path as
    # find_products) so we keep the response metadata it discards: nbHits and
    # nbPages give TRUE totals for honest pagination. Algolia pages are
    # 0-indexed; the adapter API is 1-indexed.
    svc = ProductsListService()
    svc.validate_categories_and_sizes(cats, ())
    # Ask EACH department for a FULL page, never a split budget. Departments
    # partition the corpus (an item is menswear XOR womenswear), so merging
    # page N of each is gap-free and overlap-free. Splitting the budget in half
    # silently returned half-empty pages whenever one department had no matches
    # — e.g. "carhartt" + size 34 is 4102 menswear / 0 womenswear, so a
    # 24-item request came back with 12. The caller returns everything fetched
    # and the search engine is the only layer that slices to a page.
    per_dept = int(limit)

    # Source-side size filter: raw `category_size` facet strings. The library's
    # param builder accepts plain strings alongside enum members.
    size_facets = _grailed_size_facets(sizes, cats)

    hits, total, max_pages = [], 0, 0
    saw_total = False
    raw_facets: dict = {}
    price_stats: dict = {}
    for dept in departments:
        params = svc.create_params_string(
            cats,                       # categories
            size_facets,                # sizes -> "category_size:<prefix>.<size>"
            list(designers or ()),      # designers.name
            conds,                      # conditions
            (),                         # markets
            locs,                       # locations -> "location:<value>"
            svc.get_all_facets(),
            dept,
            False,                      # staff_pick
            per_dept,                   # hitsPerPage
            100,                        # maxValuesPerFacet
            int(price_min) if price_min is not None else 0,
            int(price_max) if price_max is not None else 1_000_000,
            int(page) - 1,              # Algolia 0-indexed page
            query,
        )
        payload = {"requests": svc.get_payload_requests(False, True, params)}  # sold=False, on_sale=True
        resp = svc.send_request(payload, False)
        body = resp.json()
        results = body.get("results") or []
        first = results[0] if results else {}
        n_hits = first.get("nbHits")
        n_pages = first.get("nbPages")
        hits.extend(first.get("hits") or [])
        _merge_facets(raw_facets, first.get("facets") or {})
        _merge_price_stats(price_stats, (first.get("facets_stats") or {}).get("price_i"))
        if n_hits is not None:
            saw_total = True
        total += int(n_hits or 0)
        max_pages = max(max_pages, int(n_pages or 0))
        # Diagnostic: surfaces when the source omits nbHits/nbPages, so a missing
        # total is visible rather than silently guessed. Noisy, so opt-in via
        # ADAPTER_DEBUG=1 — but ALWAYS warn when nbHits is absent, since that's
        # the condition that used to produce a fabricated total.
        dept_name = getattr(dept, "value", dept)
        if n_hits is None:
            print(
                f"[grailed] WARN no nbHits for q={query!r} dept={dept_name} "
                f"page={page} (total will be reported as unknown) "
                f"keys={sorted(first.keys())[:12]}",
                file=sys.stderr,
            )
        elif ADAPTER_DEBUG:
            print(
                f"[grailed] q={query!r} dept={dept_name} page={page} "
                f"hits={len(first.get('hits') or [])} nbHits={n_hits} nbPages={n_pages}",
                file=sys.stderr,
            )

    # One-time raw-shape dump, for tuning map_grailed_live() against real data.
    # Opt-in (ADAPTER_DEBUG=1) — the mapping is settled, so it's just noise now.
    global _LOGGED_GRAILED_SAMPLE
    if ADAPTER_DEBUG and hits and not _LOGGED_GRAILED_SAMPLE:
        _LOGGED_GRAILED_SAMPLE = True
        sample = hits[0]
        keys = list(sample.keys()) if isinstance(sample, dict) else type(sample).__name__
        print(f"[grailed] SAMPLE keys: {keys}", file=sys.stderr)
        print(
            "[grailed] SAMPLE product: " + json.dumps(sample, default=str)[:2000],
            file=sys.stderr,
        )

    mapped, seen = [], set()
    for p in hits:
        try:
            item = map_grailed_live(p)
            if item["id"] and item["id"] not in seen:
                seen.add(item["id"])
                mapped.append(item)
        except Exception as e:  # skip malformed items rather than fail the whole feed
            print(f"[grailed] skipped an item: {e}", file=sys.stderr)

    return mapped, {
        "total": total if saw_total else None,
        "nbPages": max_pages or None,
        "facets": translate_grailed_facets(raw_facets, price_stats),
    }


def _merge_facets(acc: dict, incoming: dict):
    """Sum facet counts across the per-department requests."""
    for group, values in (incoming or {}).items():
        bucket = acc.setdefault(group, {})
        for value, count in (values or {}).items():
            bucket[value] = bucket.get(value, 0) + int(count or 0)


def _merge_price_stats(acc: dict, stats):
    if not stats:
        return
    lo, hi = stats.get("min"), stats.get("max")
    if lo is not None:
        acc["min"] = min(acc.get("min", lo), lo)
    if hi is not None:
        acc["max"] = max(acc.get("max", hi), hi)


def _leaf(value: str) -> str:
    """'footwear.lowtop_sneakers' -> 'Lowtop Sneakers'; 'tops.m' -> 'M'."""
    leaf = str(value).split(".")[-1]
    pretty = _prettify(leaf) or leaf
    # Short size tokens read better fully uppercased (M, XS, XXL).
    return pretty.upper() if len(leaf) <= 3 and not any(c.isdigit() for c in leaf) else pretty


def _buckets(counts: dict, groups: dict | None = None) -> list:
    """{value: count} -> [{value, count, group?}] sorted by count desc."""
    out = []
    for v, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        bucket = {"value": v, "count": c}
        group = (groups or {}).get(v)
        if group:
            bucket["group"] = group
        out.append(bucket)
    return out


def translate_grailed_facets(raw: dict, price_stats: dict) -> dict:
    """
    Convert Grailed's facet vocabulary into ArchiveScout's.

    These counts cover the ENTIRE matching result set, not the page we happened
    to fetch — which is what lets a broad search like "chanel" offer every real
    size, category and brand instead of only what landed on page one.
    """
    if not raw:
        return {}

    # Keep the path PREFIX as the parent group — it's the source's own
    # hierarchy, far more reliable than guessing from the leaf label.
    sizes, categories = {}, {}
    size_groups, category_groups = {}, {}

    # "footwear.10", "tops.m", "accessories.one_size" -> one size vocabulary.
    for value, count in (raw.get("category_size") or {}).items():
        label = _leaf(value)
        sizes[label] = sizes.get(label, 0) + count
        parts = str(value).split(".")
        if len(parts) > 1:
            size_groups.setdefault(label, _prettify(parts[0]))

    # "footwear.lowtop_sneakers" -> "Lowtop Sneakers" (matches the item mapper).
    for value, count in (raw.get("category_path") or {}).items():
        label = _leaf(value)
        categories[label] = categories.get(label, 0) + count
        parts = str(value).split(".")
        if len(parts) > 1:
            category_groups.setdefault(label, _prettify(parts[0]))

    conditions = {}
    for value, count in (raw.get("condition") or {}).items():
        label = _GRAILED_CONDITION.get(value, _prettify(value))
        conditions[label] = conditions.get(label, 0) + count

    genders = {}
    for value, count in (raw.get("department") or {}).items():
        genders[_prettify(value)] = genders.get(_prettify(value), 0) + count

    out = {
        "sizes": _buckets(sizes, size_groups),
        "categories": _buckets(categories, category_groups),
        "brands": _buckets(raw.get("designers.name") or {}),
        "conditions": _buckets(conditions),
        "genders": _buckets(genders),
        "locations": _buckets(raw.get("location") or {}),
    }
    if price_stats.get("min") is not None and price_stats.get("max") is not None:
        out["priceRange"] = {
            "min": int(price_stats["min"]),
            "max": int(price_stats["max"]),
        }
    return out


def _get(d, *keys, default=None):
    """Return the first present, non-None key from a dict."""
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return default


def _to_number(v):
    """Coerce a number that may arrive as int/float/str/dict into a float."""
    if v is None:
        return 0.0
    if isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace("$", "").replace(",", "").strip())
        except ValueError:
            return 0.0
    if isinstance(v, dict):
        # Common nested shapes: {amount}, {us:{amount}}, {rating_average}, {cents}...
        # Recurse so even doubly-nested values resolve.
        for k in ("amount", "value", "usd", "us", "price", "price_i", "rating_average", "rating"):
            if k in v:
                return _to_number(v[k])
        if "cents" in v:
            return _to_number(v["cents"]) / 100.0
    return 0.0


def _prettify(s):
    """'button_ups' -> 'Button Ups'."""
    if not isinstance(s, str):
        return s
    return s.replace("_", " ").replace("-", " ").strip().title()


def _prune(obj):
    """Recursively drop None values so optional fields validate cleanly."""
    if isinstance(obj, dict):
        return {k: _prune(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_prune(x) for x in obj]
    return obj


# Grailed condition codes -> ArchiveScout condition labels.
_GRAILED_CONDITION = {
    "is_new": "New with tags",
    "is_new_with_tags": "New with tags",
    "is_new_without_tags": "New without tags",
    "is_gently_used": "Excellent",
    "is_used": "Good",
    "is_worn": "Fair",
}


def _to_str(v):
    """Coerce a value that may be a str/number/dict into a display string or None."""
    if v is None or isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, dict):
        for k in ("name", "label", "value", "title"):
            if isinstance(v.get(k), str):
                return v[k]
    return None


def _str_list(v):
    """Coerce a value into a list of non-empty strings."""
    if v is None:
        return []
    if isinstance(v, (str, dict)):
        s = _to_str(v)
        return [s] if s else []
    if isinstance(v, list):
        out = [_to_str(x) for x in v]
        return [s for s in out if s]
    return []


def map_grailed_live(p: dict) -> dict:
    """
    Map a real `grailed_api` product dict -> ArchiveScout grailed raw item.
    Pinned to Grailed's actual Algolia shape (seller under `user`, dotted
    `category_path`, coded `condition`, image in `cover_photo`), with defensive
    coercion + None-pruning so the output always satisfies grailedRawItemSchema.
    """
    # Brand: `designer_names` is a string ("Chanel"); `designers` is [{name}].
    designers = _str_list(_get(p, "designer_names", "designers", default=None))

    # category_path is a dotted string, e.g. "accessories.wallets" -> specific first.
    cat_raw = _get(p, "category_path", default=None)
    if isinstance(cat_raw, str):
        segs = [s for s in cat_raw.split(".") if s]
        category_path = [_prettify(s) for s in reversed(segs)]
    elif isinstance(cat_raw, list):
        category_path = _str_list(cat_raw)
    else:
        category_path = _str_list(_get(p, "category", default=None))

    # Condition code -> label ("is_gently_used" -> "Excellent").
    cond_raw = _to_str(_get(p, "condition", default=None))
    condition = _GRAILED_CONDITION.get(cond_raw, _prettify(cond_raw))

    # Image: search response carries a single cover_photo.
    cover = _get(p, "cover_photo", default=None)
    photo_objs = []
    if isinstance(cover, dict):
        url = cover.get("url") or cover.get("image_url")
        if isinstance(url, str) and url.startswith("http"):
            photo_objs.append({"url": url})

    # Seller lives under `user`.
    user = _get(p, "user", "seller", default={}) or {}
    rating = _to_number(_get(user, "seller_score", "score", default=None)) or None

    shipping = _get(p, "shipping", default=None)  # {"us": {"amount": 30, ...}, ...}

    item = {
        "id": str(_get(p, "id", "objectID", default="")),
        "title": _to_str(_get(p, "title", default=None)) or "Grailed listing",
        "designer_names": designers,
        "category_path": category_path,
        "size": _to_str(_get(p, "size", "size_name", default=None)),
        "condition": condition,
        "color": _prettify(_to_str(_get(p, "color", "colour", default=None))),
        "price": _to_number(_get(p, "price", "price_i", default=0)),
        "shipping": {"us": _to_number(shipping)},
        "currency": _to_str(_get(p, "currency", default=None)) or "USD",
        "photos": photo_objs,
        "seller": {
            "username": _to_str(_get(user, "username", "name", default=None)),
            "seller_score": round(rating, 2) if rating else None,
            "badges": ["trusted"] if _get(user, "trusted_seller", default=False) else [],
        },
        "location": _to_str(_get(p, "location", default=None)),
        "created_at": _to_str(_get(p, "created_at", "createdAt", default=None)),
        "department": _to_str(_get(p, "department", default=None)),
        "description": _to_str(_get(p, "description", default=None)),
    }
    return _prune(item)



# ─────────────────────────── HTTP layer ───────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "ArchiveScoutAdapter/1.0"

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return False
        token = auth[len("Bearer ") :].strip()
        if API_KEY:
            return token == API_KEY
        return bool(token)

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        parts = [p for p in parsed.path.split("/") if p]
        if not parts:
            return self._json(200, {"ok": True, "service": "archivescout-adapter"})

        marketplace = parts[0]
        if marketplace != "grailed":
            return self._json(404, {"error": "unknown marketplace"})

        if not self._authorized():
            return self._json(401, {"error": "missing or invalid bearer token"})

        qs = parse_qs(parsed.query)
        query = (qs.get("q") or qs.get("query") or [""])[0]
        page = max(1, int((qs.get("page") or ["1"])[0] or 1))
        limit = max(1, int((qs.get("limit") or qs.get("hits_per_page") or ["24"])[0] or 24))
        price_min = _num(qs.get("price_min"))
        price_max = _num(qs.get("price_max"))

        # Filters forwarded by the app (comma-separated), translated to Grailed
        # query params in search_grailed_live().
        filters = {
            "designers": _csv(qs.get("designers")),
            "categories": _csv(qs.get("categories")),
            "conditions": _csv(qs.get("conditions")),
            "sizes": _csv(qs.get("sizes")),
            "locations": _csv(qs.get("locations")),
            "department": (qs.get("department") or [None])[0],
        }

        # Single-item lookup: /grailed/<id>
        single_id = parts[1] if len(parts) > 1 else None

        try:
            if single_id:
                item = get_grailed_item(single_id)
                return self._json(200, item) if item else self._json(404, {"error": "not found"})
            result = search_grailed(query, page, limit, price_min, price_max, filters)
            return self._json(200, result)
        except Exception as e:
            print(f"[adapter] {marketplace} error: {e}", file=sys.stderr)
            return self._json(502, {"error": str(e)})

    def log_message(self, fmt, *args):  # quieter logs
        sys.stderr.write("[adapter] " + (fmt % args) + "\n")


def _num(vals):
    if not vals:
        return None
    try:
        return float(vals[0])
    except (ValueError, TypeError):
        return None


def _csv(vals):
    """['a,b,c'] -> ['a','b','c']; missing -> []."""
    if not vals:
        return []
    return [s.strip() for s in vals[0].split(",") if s.strip()]


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(
        f"ArchiveScout adapter on http://localhost:{PORT} "
        f"(grailed=live, auth={'on' if API_KEY else 'any-bearer'})",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
