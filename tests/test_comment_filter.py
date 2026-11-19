from comment_filter import classify

KEEP = {
    "Ok I need this 🔥": "intent", "Just bought it": "intent", "Seen the xl size put it in my cart ❤️❤️": "intent",
    "Adding the blue one to my cart immediately 💙💙": "intent", "Where is the dress from😍": "intent", "Neeeed": "intent",
    "lo quiero en rojo": "intent",
    "Im 5’2-5’3 and 118 what size do u think I should get??😅": "size", "Is this true to size": "size", "does it stretch?": "size",
    "que talla es el q pediste?": "size",
    "Is it itchy tho?": "material", "sadly it’s polyester 😭😭": "material",
    "normal price in tiktok shop am I in heaven?": "price", "can you restock navy blue XL?": "intent",
    "Is this the navy blue color? It looks brighter than the picture": "color",
    "I have this dress & it comes off a little bit after u wash it": "owner", "Wearing this dress tonight for my dads party": "owner",
    "i have this same dress off amazon": "dupe",
}
DROP = ["The end with the wall made me think booktok would be in the comments… my hubby needs to take notes!", "So pretty 😍", "You look amazing 🔥", "Teamwork", "Merry Christmas", "😍😍😍", "How cute!", "bello", "The name😭"]


def test_keeps_useful_comments():
    for text, tag in KEEP.items():
        assert tag in classify(text), (text, classify(text))


def test_drops_small_talk():
    for text in DROP:
        assert classify(text) == [], (text, classify(text))
