"""Which video comments matter for selling: buying intent, buyer questions, worries and experiences."""
from __future__ import annotations

import re

W = r"(?<![\w'])"   # word start that also works after emoji / punctuation
TAGS: list[tuple[str, re.Pattern]] = [
    ("intent", re.compile(W + r"(ne+e+d+s?(ed)?\b|i need|need (this|it|that|one|these)|want (this|it|one|that|these)|i want|wan+t+ ?it"
                          r"|(add(ed|ing)?|put(ting)?|thr[eo]w(ing)?)\b[^.!?]{0,25}\b(to|in|into) (my |the )?cart|in (my|the) cart"
                          r"|(just |already |finally )?(bought|ordered|purchased|copped|buying|grabbed) (it|this|one|mine|the|that|a|two|2)"
                          r"|just (bought|ordered|purchased|copped)|gonna (buy|get|order|cop)|getting (this|it|one)|take my money|must have|have to have"
                          r"|where('?s| is| are| did| can| do| to)\b[^?!.]{0,30}\b(from|get|buy|find|order)|link\b|restock"
                          r"|lo quiero|lo necesito|lo ped[ií]|lo compr[eé]|d[oó]nde lo|lo acabo de)", re.I)),
    ("size", re.compile(W + r"(sizes?\b|sizing|true to size|\btts\b|runs? (small|big|large)|size (up|down)|\bfits?\b|fitting|how tall|tall girls?|petite"
                        r"|plus.?size|curvy|\blbs?\b|pounds|\bkg\b|my height|\b[0-9]x\b|\bxx?[sl]\b|stretch(y|es)?|talla"
                        r"|\b[4-6]\s?['’]\s?\d{0,2}|\b[4-6] ?ft)", re.I)),
    ("material", re.compile(W + r"(itch(y|es|ing)?|comfortable|comfy|see.?through|sheer|transparent|fabric|material|polyester|cotton|quality"
                            r"|lining|lined|wash(ed|ing)?\b|shed(s|ding)?|fall(s|ing)? off|came off|pill(s|ing)|breathable|scratchy|soft\b"
                            r"|thin\b|thick\b|picaz[oó]n|tela)", re.I)),
    ("price", re.compile(W + r"(price|cheap(er)?|expensive|pricey|\$\s?\d+|shipping|ship(s|ped)?\b|arrived?|delivery|deliver"
                         r"|sold out|out of stock|in stock|coupon|discount|on sale|precio|env[ií]o)", re.I)),
    ("color", re.compile(W + r"(colou?rs?\b[^.!]*\?|comes? in|other colou?rs?|what colou?r|which colou?r|colou?r is|in (black|white|red|blue|navy|pink|green|purple|brown|beige|baby pink|light blue|silver|gold)\b)", re.I)),
    ("owner", re.compile(W + r"(i (have|got|own|wore|bought|ordered|received) (this|it|the same|mine|one|that)|mine (came|is|was|arrived|just)"
                         r"|wore (it|this|mine)|i wore|wearing (this|it|mine)( \w+)? (tonight|today|to|for)|came apart|(it|mine) (arrived|came) (today|yesterday|early|late|fast|quick|in the mail)|lo tengo|yo tambi[eé]n lo tengo)", re.I)),
    ("dupe", re.compile(W + r"(shein|amazon|temu|windsor|zara|h&m|fashion nova|\bdupe|cheaper on|same (dress|one|thing|top)|walmart|target\b)", re.I)),
]


def classify(text: str | None) -> list[str]:
    """Tags of a comment; an empty list means it is not useful for us."""
    t = (text or "").strip()
    if len(re.sub(r"[^\w]", "", t)) < 3:     # emoji-only or a couple of letters
        return []
    return [name for name, rx in TAGS if rx.search(t)]
