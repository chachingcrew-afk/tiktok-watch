"""Product niches: what the shop scan searches and how products are grouped.

Each niche lists the TikTok Shop US category pages to scan (slug/id), how many pages to load per
category, its price band, and how a product is assigned to it: by category name or by a keyword in
the title. The keyword rules are checked first (in this order), then the category names, so a
"cooling pillow" lands in midlife comfort even though it sits in the bedding category.

The list is stored in tiktok_watch.settings under 'niches' (editable from the web app) and the
database assigns shop_products.niche with the same rules (tiktok_watch.niche_of).
"""
from __future__ import annotations

import re

DEFAULT_NICHES: list[dict] = [
    {"key": "midlife", "label": "Középkorú nők komfortja",
     "cats": ["women-s-sleepwear-loungewear/843016", "bedding-and-linens/808328", "home-appliances/844808"],
     "loads": 6, "min_price": 15, "max_price": 120, "skip_brands": True,
     "kw": r"hot flash|night sweat|menopaus|perimenopaus|cooling (pajama|pyjama|sleepwear|nightgown|sheet|pillow|blanket|comforter|towel|neck|mattress)|moisture[- ]wicking (pajama|sleep|sheet)",
     "names": []},
    {"key": "kids", "label": "Gyerektermékek (anyukáknak)",
     "cats": ["baby-maternity/602284", "baby-care-health/879112", "nursing-feeding/877832", "baby-safety/878600",
              "baby-travel-gear/877576", "baby-toys/878984", "educational-toys/859784", "kids-fashion/802184",
              "girls-clothes/803592", "boys-clothes/802312", "maternity-supplies/880008", "children-s-furniture/871304"],
     "loads": 5, "min_price": 15, "max_price": 90, "skip_brands": True,
     "kw": r"\b(toddlers?|infants?|newborns?|nursery|stroller|teether|teething|pacifier|diapers?|potty|breast ?pump|nursing pillow|baby (monitor|bottle|carrier|bath|gate|food|wipes|swing|bouncer|toys?|lotion|shampoo|nail))\b|for (babies|kids|toddlers|boys|girls)\b",
     "names": ["Baby & Maternity", "Baby Care & Health", "Nursing & Feeding", "Baby Safety", "Baby Travel Gear", "Baby Toys",
               "Educational Toys", "Kids' Fashion", "Girls' Clothes", "Boys' Clothes", "Maternity Supplies", "Children's Furniture",
               "Baby Clothing & Shoes", "Baby Fashion Accessories", "Kids' Fashion Accessories", "Baby Furniture",
               "Breast Pumps & Accessories", "Children's & Infants' Books", "Dolls & Stuffed Toys"]},
    {"key": "supplements", "label": "Étrend-kiegészítők",
     "cats": ["nutrition-wellness/700646", "alternative-medications-treatments/950792"],
     "loads": 8, "min_price": 15, "max_price": 90, "skip_brands": False,
     "kw": r"\b(supplements?|gummies|capsules|softgels|multivitamin|probiotic|collagen peptides|magnesium (glycinate|complex)|electrolyte powder|creatine)\b",
     "names": ["Nutrition & Wellness", "Vitamins, Minerals & Wellness Supplements", "Beauty Supplement", "Fitness Supplements",
               "Alternative Medications & Treatments", "Sports Nutrition", "Weight Management"]},
    {"key": "hair", "label": "Hajritkulás, hajápolás",
     "cats": ["haircare-styling/848904", "hair-dryers/874376", "curlers-straighteners/874504", "hair-accessories/905864",
              "hair-extensions-wigs/810128"],
     "loads": 8, "min_price": 15, "max_price": 90, "skip_brands": False,
     "kw": r"hair (loss|growth|thinning|regrowth)|thinning hair|scalp (massager|serum|scrub|care)|hair topper|root (touch|cover)",
     "names": ["Haircare & Styling", "Shampoo & Conditioner", "Hair Loss Products", "Hair Oils & Treatments", "Hair Care",
               "Mousse & Gel", "Hair Styling Powders", "Curlers & Straighteners", "Hair Dryers", "Hair Accessories",
               "Hair Extensions & Wigs", "Hair Colour", "Hair Treatments"]},
    {"key": "pain", "label": "Fájdalom, testtartás, regeneráció",
     "cats": ["massage-devices/601660", "personal-care-appliances/849416", "heating-pad/2167568", "medical-supplies/924424",
              "hand-foot-care/849032", "fitness/835336"],
     "loads": 8, "min_price": 20, "max_price": 120, "skip_brands": False,
     "kw": r"posture|back pain|neck pain|lower back|sciatica|plantar|knee (brace|pain)|massager|massage gun|heating pad|tens unit|lumbar|neck stretcher",
     "names": ["Massage Devices", "Personal Care Appliances", "Heating Pad", "Medical Supplies", "Hand & Foot Care", "Fitness",
               "Health Monitors & Tests", "Ab Training", "Exercise Machines", "Strength Training Equipment", "Massage Chairs",
               "Fitness Accessories", "Yoga & Pilates"]},
    {"key": "sleep", "label": "Alvás",
     "cats": ["bedding-and-linens/808328", "textiles-soft-furnishings/600154", "household-textiles/809992"],
     "loads": 8, "min_price": 20, "max_price": 120, "skip_brands": False,
     "kw": r"snor|sleep mask|white noise|weighted blanket|(contour|wedge|cervical|memory foam|side sleeper|cooling) pillow|mouth tape",
     "names": ["Pillows & Bed Wedges", "Sleep & Snoring", "Sleep Masks", "Bedding and Linens", "Blankets & Throws",
               "Sheets & Pillowcases", "Bedding Sets Collections", "Duvets & Sets", "Household Textiles", "Textiles & Soft Furnishings",
               "Mattress Toppers"]},
    {"key": "fashion", "label": "Női divat, alakformálás",
     "cats": ["womenswear-underwear/601152", "women-s-tops/842248", "women-s-bottoms/842376", "women-s-suits-sets/842760",
              "women-s-underwear/842888", "women-s-special-clothing/842632", "dresses/889096", "casual-dresses/601281",
              "skirts/601264", "shapewear/601259", "lingerie/845192", "bras/601262", "tights/844552", "leggings/601274",
              "women-s-sleepwear-loungewear/843016"],
     "deep": ["formal-dresses/601271", "bridesmaid-dresses/961672", "women-s-dresses/842504"], "deep_loads": 40,
     "loads": 10, "min_price": 20, "max_price": 90, "skip_brands": True,
     "kw": r"\b(shapewear|tummy control|butt lifter|faja|body shaper)\b",
     "names": ["Womenswear & Underwear", "Women's Tops", "Women's Bottoms", "Women's Suits & Sets", "Women's Underwear",
               "Women's Special Clothing", "Dresses", "Casual Dresses", "Formal Dresses", "Bridesmaid Dresses", "Women's Dresses",
               "Skirts", "Shapewear", "Lingerie", "Bras", "Tights", "Leggings", "Women's Sleepwear & Loungewear", "Women's Knitwear",
               "Jackets & Coats", "Pants", "Jeans", "Women's T-shirts", "Blouses & Shirts", "Overalls", "Hoodies & Sweatshirts",
               "Women's Clothing Sets", "Pajamas & Loungewear", "Bathrobes & Dressing Gowns", "Sports Bottoms", "Sports Clothing Sets",
               "Bodysuits", "Jumpsuits & Rompers", "Swimwear, Surfwear & Wetsuits", "Women's Boots"]},
    {"key": "pets", "label": "Kisállatok",
     "cats": ["dog-cat-accessories/818696", "dog-cat-grooming/816392", "dog-cat-furniture/812808", "dog-cat-healthcare/818184",
              "dog-cat-clothing/813960", "dog-cat-litter/815624"],
     "loads": 6, "min_price": 15, "max_price": 90, "skip_brands": False,
     "kw": r"\b(dogs?|cats?|puppy|kitten|pet) (bed|brush|deshedding|de-shedding|grooming|litter|feeder|ramp|stairs|calming|anxiety|harness|fountain)\b",
     "names": ["Dog & Cat Accessories", "Dog & Cat Grooming", "Dog & Cat Furniture", "Dog & Cat Healthcare", "Dog & Cat Clothing",
               "Dog & Cat Litter", "Pet Supplies"]},
    {"key": "skin", "label": "Bőrápolás, szépségeszközök",
     "cats": ["facial-beauty-devices/601672", "body-beauty-devices/601664", "skincare/848776", "bath-body-care/849160"],
     "loads": 6, "min_price": 15, "max_price": 90, "skip_brands": True,
     "kw": r"led (face )?mask|red light therapy|ice roller|gua sha|microcurrent|blackhead (remover|vacuum)|exfoliating (mitt|glove)",
     "names": ["Facial Beauty Devices", "Body Beauty Devices", "Skincare", "Bath & Body Care", "Serums & Essences", "Skin Care Kits",
               "Moisturizers & Mists", "Face Scrubs & Peels", "Eye Treatments", "Face Masks", "Toners", "Acne Treatments",
               "Facial Sunscreen & Sun Care", "Facial Massage Cream", "Body Scrubs & Peels", "Lip Treatments", "Body Moisturizers",
               "Body Care Sets", "Bath & Shower", "Body & Massage Oil", "Facial Cleansers"]},
]

KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,23}$")
CAT_RE = re.compile(r"^[a-z0-9\-]+/\d+$")


def clean(value) -> list[dict] | None:
    """Validate a niches list from the settings; None when unusable."""
    if not isinstance(value, list):
        return None
    out = []
    for n in value:
        if not isinstance(n, dict) or not KEY_RE.match(str(n.get("key", ""))):
            continue
        cats = [c for c in (n.get("cats") or []) if CAT_RE.match(str(c))]
        deep = [c for c in (n.get("deep") or []) if CAT_RE.match(str(c))]
        kw = str(n.get("kw") or "")
        try:
            re.compile(kw)
        except re.error:
            kw = ""

        def num(k, d, lo=0, hi=100000):
            v = n.get(k, d)
            return v if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else d
        out.append({"key": n["key"], "label": str(n.get("label") or n["key"])[:60], "cats": cats, "deep": deep,
                    "deep_loads": int(num("deep_loads", 0, 0, 60)), "loads": int(num("loads", 5, 0, 60)),
                    "min_price": num("min_price", 0), "max_price": num("max_price", 1000), "skip_brands": bool(n.get("skip_brands")),
                    "kw": kw, "names": [str(x)[:80] for x in (n.get("names") or []) if str(x).strip()]})
    return out or None


def niche_of(niches: list[dict], category_name: str | None, title: str | None) -> str | None:
    """Same rule as tiktok_watch.niche_of in the database: title keywords first, then category names."""
    t = title or ""
    for n in niches:
        if n.get("kw") and re.search(n["kw"], t, re.I):
            return n["key"]
    for n in niches:
        if category_name and category_name in (n.get("names") or []):
            return n["key"]
    return None
