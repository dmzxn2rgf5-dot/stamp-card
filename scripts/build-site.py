#!/usr/bin/env python3
"""Generates the Stamp Card marketing site (static, for GitHub Pages).

Run from the repo root: python3 scripts/build-site.py  (needs: pip install qrcode)
It rebuilds site/ from scratch, so edit this file, not the HTML.
"""
import json, os, shutil, html
from datetime import date

BASE = "https://dmzxn2rgf5-dot.github.io/stamp-card/"
REPO = "https://github.com/dmzxn2rgf5-dot/stamp-card"
# IndexNow key (public by design): served at site/<key>.txt so search engines can verify pings.
INDEXNOW_KEY = "tQChQn6EtQmeVjKkB6D9vgZcTV9aC4hp"
KEY = "6b778227-8154-4f3e-a4db-b113abc77d11"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")
TODAY = date.today().isoformat()

VENUES = [
    # slug, name, plural, reward, earn, hook, tip
    ("coffee-shops", "Coffee shop", "coffee shops", "a free coffee", "every coffee", "Your regulars come in every morning. Give them a reason to never go anywhere else.", "Set it to 9 stamps so the 10th coffee is on the house. It's the classic."),
    ("cafes", "Café", "cafés", "a free hot drink", "every visit", "Breakfast, brunch, a quick flat white. A stamp card turns a nice café into their café.", "Reward visits, not spend. It keeps it simple for staff at the counter."),
    ("bars", "Bar", "bars", "a free drink", "every round", "Turn a one-off night out into the bar they always end up in.", "Try 6 stamps for a free drink. Short cards get finished, and finished cards bring people back."),
    ("pubs", "Pub", "pubs", "a free pint", "every pint", "Locals are the lifeblood of a pub. Thank them properly, without paper cards behind the bar.", "Use the broadcast pop-up for quiz night or match day offers."),
    ("restaurants", "Restaurant", "restaurants", "a free dessert", "every meal", "Get diners back for a second visit. And a third.", "Stamp per table or per visit, whatever suits your service."),
    ("takeaways", "Takeaway", "takeaways", "a free meal", "every order", "Your customers can order from twenty places on an app. Give them a reason to order from you.", "Stamp collection orders at the counter. It nudges people to pick up rather than pay delivery app fees."),
    ("sandwich-shops", "Sandwich shop", "sandwich shops", "a free sandwich", "every lunch", "Same office workers, same lunch hour, every day. Make sure it's your sandwich.", "8 lunches, 9th free. Easy maths, fast at the till."),
    ("burger-joints", "Burger joint", "burger joints", "a free burger", "every burger", "Burger lovers are loyal once they find their place. Make it yours.", "Stamp on burgers only, or on every order. You choose the wording."),
    ("fish-and-chip-shops", "Fish and chip shop", "fish and chip shops", "a free fish supper", "every order", "Friday night chippy tea is a ritual. Make sure it's your chippy.", "Set the reward to \"Free fish and chips\" and watch Friday queues grow."),
    ("chinese-takeaways", "Chinese takeaway", "Chinese takeaways", "a free main", "every order", "Your regular Saturday-night customers deserve a thank you.", "Stamp every collection order. It's a simple reason to choose you over the delivery apps."),
    ("indian-takeaways", "Indian takeaway", "Indian takeaways", "a free curry", "every order", "Curry night regulars are gold. Keep them coming back to you.", "Try \"10th curry free\". It's simple and everyone gets it."),
    ("chicken-shops", "Chicken shop", "chicken shops", "a free meal", "every meal", "Fast, busy and full of repeat customers. A stamp card that takes two seconds at the till fits perfectly.", "Keep the card short. 6 stamps for a free meal keeps people chasing it."),
    ("pizza-shops", "Pizza shop", "pizza shops", "a free pizza", "every pizza", "Pizza night comes round every week. Make sure they ring you.", "Stamp collection orders to win customers back from delivery apps."),
    ("bakeries", "Bakery", "bakeries", "a free pastry", "every visit", "Morning loaf, Saturday treats. Turn your bakery into a daily habit.", "Reward visits rather than items. It's fair for the person buying one roll or ten."),
    ("food-trucks", "Food truck", "food trucks", "a free meal", "every meal", "Your customers follow you around town. Give them a card that follows them too, right on their phone.", "Use the broadcast pop-up to tell regulars where you're parked this week."),
    ("ice-cream-shops", "Ice cream shop", "ice cream shops", "a free scoop", "every cone", "Summer regulars and Sunday treats. A stamp card is made for ice cream.", "Short and sweet. 5 stamps for a free scoop works well with kids and families."),
    ("juice-bars", "Juice bar", "juice bars", "a free smoothie", "every smoothie", "Health-kick regulars come in several times a week. Reward the habit.", "Pair it with the broadcast pop-up for a new seasonal blend."),
    ("barbers-and-salons", "Barber or salon", "barbers and salons", "a free cut", "every visit", "It isn't just for food. Any business with regulars can use it.", "Try 6 visits and the 7th is on you."),
]

COUNTRIES = [
    # slug, name, takeaway word, card word, demonym note
    ("uk", "the UK", "takeaway", "loyalty card", "From Cornish cafés to Glasgow chippies."),
    ("us", "the US", "takeout", "punch card", "From New York delis to LA taco trucks."),
    ("australia", "Australia", "takeaway", "loyalty card", "From Melbourne laneway cafés to Brisbane burger bars."),
    ("canada", "Canada", "takeout", "punch card", "From Toronto coffee shops to Vancouver food trucks."),
    ("ireland", "Ireland", "takeaway", "loyalty card", "From Dublin coffee bars to Galway chippers."),
    ("new-zealand", "New Zealand", "takeaway", "loyalty card", "From Auckland espresso bars to Wellington fish and chips."),
]

CSS = """
:root{--ink:#0b1f4b;--blue:#2f6fed;--soft:#eef3fe;--text:#1d2433;--muted:#5b6475;--line:#e3e7ef;--ok:#0f9d58}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--text);line-height:1.6;background:#fff}
a{color:var(--blue)}img{max-width:100%}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:5}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;height:60px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800;color:var(--ink);text-decoration:none;font-size:18px}
.logo svg{width:28px;height:28px}
nav a{margin-left:18px;color:var(--text);text-decoration:none;font-size:15px}
nav a.btn{color:#fff}
.btn{display:inline-block;background:var(--blue);color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;border:0;font-size:16px;cursor:pointer}
.btn.alt{background:#fff;color:var(--ink);border:2px solid var(--ink)}
.hero{background:linear-gradient(180deg,var(--soft),#fff);padding:56px 0 40px}
.hero .wrap{display:grid;grid-template-columns:1.2fr .8fr;gap:40px;align-items:center}
h1{font-size:44px;line-height:1.1;color:var(--ink);margin:0 0 16px;letter-spacing:-.02em}
h2{font-size:30px;color:var(--ink);margin:0 0 14px;letter-spacing:-.01em}
h3{color:var(--ink);margin:0 0 8px}
.lead{font-size:20px;color:var(--muted);margin:0 0 24px}
.pills{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px;padding:0;list-style:none}
.pills li{background:#fff;border:1px solid var(--line);border-radius:99px;padding:6px 12px;font-weight:600;font-size:14px}
.ctas{display:flex;gap:12px;flex-wrap:wrap}
section{padding:56px 0}
section.alt{background:var(--soft)}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px}
.steps{counter-reset:s;list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.steps li{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px;position:relative}
.steps li:before{counter-increment:s;content:counter(s);display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--blue);color:#fff;font-weight:800;margin-bottom:10px}
.venue{display:block;padding:14px 16px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:var(--ink);font-weight:600;background:#fff}
.venue:hover{border-color:var(--blue)}
.price{font-size:34px;font-weight:800;color:var(--ink);margin:6px 0}
.tag{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--blue)}
.faq details{border-bottom:1px solid var(--line);padding:14px 0}
.faq summary{font-weight:700;cursor:pointer;color:var(--ink)}
footer{background:var(--ink);color:#cfd8ea;padding:36px 0;font-size:14px}
footer a{color:#fff}
.phone{width:260px;margin:0 auto;border-radius:36px;background:#111;padding:12px;box-shadow:0 20px 50px rgba(11,31,75,.25)}
.screen{background:#fff;border-radius:26px;padding:22px 18px;text-align:center}
.screen .shop{font-weight:800;color:var(--ink);font-size:18px}
.screen .sub{color:var(--muted);font-size:13px;margin-bottom:14px}
.stamps{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}
.stamps span{aspect-ratio:1;border-radius:50%;border:2px dashed #c8d1e3}
.stamps span.on{background:var(--blue);border:2px solid var(--blue);box-shadow:inset 0 0 0 4px #fff}
.screen .count{font-weight:700;color:var(--ink);font-size:14px;margin-bottom:12px}
.qr{width:120px;height:120px;margin:0 auto 8px;background:
 conic-gradient(from 90deg at 2px 2px,#0000 90deg,#111 0) 0 0/12px 12px;border:8px solid #fff;outline:2px solid #111;border-radius:6px;opacity:.9}
.screen small{color:var(--muted);font-size:11px}
.illus{font-size:12px;color:var(--muted);text-align:center;margin-top:10px}
form .field{margin-bottom:16px}
form label{display:block;font-weight:700;margin-bottom:6px;color:var(--ink)}
form input[type=text],form input[type=email],form select,form textarea{width:100%;padding:12px;border:1px solid #c8d1e3;border-radius:10px;font-size:16px;font-family:inherit}
.choice{display:block;border:1px solid #c8d1e3;border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;font-weight:400}
.choice input{margin-right:8px}
.choice b{color:var(--ink)}
.err{color:#c62828;font-weight:600;display:none;margin-bottom:12px}
.crumbs{font-size:14px;color:var(--muted);margin-bottom:12px}
.crumbs a{color:var(--muted)}
@media(max-width:820px){h1{font-size:34px}.hero .wrap,.grid3,.steps{grid-template-columns:1fr}.grid4{grid-template-columns:repeat(2,1fr)}nav a:not(.btn){display:none}}
"""

LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0b1f4b"/><circle cx="11" cy="12" r="4" fill="#2f6fed"/><circle cx="21" cy="12" r="4" fill="#2f6fed"/><circle cx="11" cy="21" r="4" fill="#2f6fed"/><circle cx="21" cy="21" r="4" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="2 2"/></svg>'


def esc(s):
    return html.escape(s, quote=True)


def page(path, title, desc, body, jsonld=None):
    depth = path.count("/")
    root = "../" * depth
    url = BASE + (path.rsplit("index.html", 1)[0] if path.endswith("index.html") else path)
    ld = ""
    if jsonld:
        ld = "".join(f'<script type="application/ld+json">{json.dumps(j)}</script>' for j in jsonld)
    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{BASE}og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{root}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="{root}style.css">
{ld}
</head>
<body>
<header class="top"><div class="wrap">
<a class="logo" href="{root}">{LOGO}Stamp Card</a>
<nav><a href="{root}#how">How it works</a><a href="{root}#venues">Who it's for</a><a href="{REPO}">GitHub</a><a class="btn" href="{root}get-it/">Get it free</a></nav>
</div></header>
{body.replace('{root}', root)}
<footer><div class="wrap">
<p><b>Stamp Card</b> – the loyalty card alternative. Free and open source under the MIT licence.</p>
<p><a href="{root}">Home</a> · <a href="{root}get-it/">Get Stamp Card</a> · <a href="{REPO}">Source code on GitHub</a> · <a href="{root}privacy/">Privacy</a></p>
<p>Made in Bournemouth, UK, for a friend's coffee shop.</p>
</div></footer>
</body></html>"""
    full = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(full) or OUT, exist_ok=True)
    with open(full, "w") as f:
        f.write(doc)
    return url


def _qr():
    import qrcode, qrcode.image.svg, io
    q=qrcode.QRCode(border=1);q.add_data(BASE+"get-it/");q.make(fit=True)
    b=io.BytesIO();q.make_image(image_factory=qrcode.image.svg.SvgPathImage).save(b)
    svg=b.getvalue().decode().split("?>",1)[-1]
    return '<div style="width:120px;margin:0 auto 8px" aria-hidden="true">'+svg.replace("<svg ",'<svg style="width:120px;height:120px" ',1)+'</div>'
QR=_qr()


def phone(shop="Your Shop", on=7, reward="Free coffee"):
    dots = "".join(f'<span class="{"on" if i < on else ""}"></span>' for i in range(10))
    return f"""<div><div class="phone"><div class="screen">
<div class="shop">{esc(shop)}</div><div class="sub">Loyalty card</div>
<div class="stamps">{dots}</div>
<div class="count">{on} of 10 – {10-on} more for {esc(reward.lower())}</div>
{QR}<small>Show this to staff</small>
</div></div><div class="illus">Illustration. Your logo, colours and reward.</div></div>"""


HOW = """<section id="how"><div class="wrap">
<h2>How it works</h2>
<p class="lead">No app. No hardware. No training beyond "scan it and tap plus".</p>
<ol class="steps">
<li><h3>Customer scans</h3>They scan the QR poster on your counter. Their card opens in their phone's browser. No download, no sign-up.</li>
<li><h3>Staff stamp</h3>Your staff scan the customer's card with their own phone camera and tap +1. The stamp appears on the customer's screen in seconds.</li>
<li><h3>Reward and repeat</h3>Card full? Staff tap Redeem. Reward given, fresh card. The card stays on their phone for next time.</li>
</ol></div></section>"""

WHY = """<section class="alt"><div class="wrap">
<h2>Why it's free</h2>
<div class="grid3">
<div class="card"><h3>No subscription</h3>Most digital loyalty apps charge every month, forever. Stamp Card doesn't. You own it.</div>
<div class="card"><h3>No running costs</h3>It runs on Cloudflare's free tier. No server to rent. No database bill. Even a busy venue fits.</div>
<div class="card"><h3>No app for anyone</h3>Customers don't download anything. Staff don't either. It's all web pages, on phones they already have.</div>
<div class="card"><h3>Your brand</h3>Your logo, your colours, your reward. Set it up in your browser with no code.</div>
<div class="card"><h3>Staff PINs and undo</h3>Every stamp is logged against a named person. Mistakes can be undone.</div>
<div class="card"><h3>Offers that pop up</h3>Post a message and it pops up on every customer's card the next time they open it.</div>
</div></div></section>"""

OPTIONS = """<section id="options"><div class="wrap">
<h2>Three ways to get it</h2>
<div class="grid3">
<div class="card"><span class="tag">Do it yourself</span><div class="price">Free</div><p>All the code, free forever. If you're comfortable following setup steps on a computer, you can be live in under an hour.</p><a class="btn alt" href="https://github.com/dmzxn2rgf5-dot/stamp-card">Get the code</a></div>
<div class="card"><span class="tag">Guided kit</span><div class="price">£25</div><p>A plain-English, step-by-step guide. Use Claude to build your own branded version, with no coding needed. Printable posters included.</p><a class="btn" href="{root}get-it/?want=kit">Get the guided kit</a></div>
<div class="card"><span class="tag">Done for you</span><div class="price">£199</div><p>One-off. We set it up for you, branded with your logo and colours and ready to scan. No monthly fees, ever.</p><a class="btn" href="{root}get-it/?want=done">Get it done for me</a></div>
</div></div></section>"""


def venue_grid(root="{root}"):
    links = "".join(f'<a class="venue" href="{root}for/{v[0]}/">{esc(v[2][0].upper()+v[2][1:])}</a>' for v in VENUES)
    return f"""<section id="venues" class="alt"><div class="wrap">
<h2>Built for anywhere with regulars</h2>
<div class="grid4">{links}</div></div></section>"""


FAQ = [
    ("Is it really free?", "Yes. The software is free and open source. It runs on Cloudflare's free tier, so for most venues there's nothing to pay at all. The only optional cost is email card recovery, which needs Cloudflare's paid plan at about $5 a month."),
    ("Do my customers need an app?", "No. They scan a QR code and their card opens in their phone's browser. It stays there for next time. No download, no account, no password."),
    ("Do my staff need an app?", "No. Staff scan the customer's card with their normal phone camera and tap how many stamps to give."),
    ("What if a customer loses their card?", "If you switch on email recovery, customers can save their card to an email address and get it back with a sign-in link."),
    ("Can I use my own logo and colours?", "Yes. Your name, logo, colours, stamp icon and reward are all set in your browser during setup."),
    ("I'm not technical. Can I still use it?", "Yes. The guided kit walks you through it step by step, or we can set it up for you."),
    ("Does it work outside the UK?", "Yes. It works anywhere. It's in English, and there's no currency involved because you're giving stamps, not taking payments."),
]


def faq_html():
    items = "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in FAQ)
    return f'<section class="faq"><div class="wrap"><h2>Questions</h2>{items}</div></section>'


def faq_ld():
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]}


APP_LD = {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": "Stamp Card",
          "applicationCategory": "BusinessApplication", "operatingSystem": "Web",
          "description": "Free, open-source digital stamp card for coffee shops, bars, restaurants and takeaways. No app, no subscription.",
          "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}, "url": BASE}


def cta_band(text="Ready to ditch the paper cards?"):
    return f"""<section class="alt"><div class="wrap" style="text-align:center">
<h2>{esc(text)}</h2><p class="lead">Free to use. Or let us set it up for you.</p>
<div class="ctas" style="justify-content:center"><a class="btn" href="{{root}}get-it/">Get Stamp Card</a><a class="btn alt" href="https://github.com/dmzxn2rgf5-dot/stamp-card">See the code</a></div>
</div></section>"""


def build():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    with open(os.path.join(OUT, "style.css"), "w") as f:
        f.write(CSS)
    with open(os.path.join(OUT, "favicon.svg"), "w") as f:
        f.write(LOGO.replace(' aria-hidden="true"', ' xmlns="http://www.w3.org/2000/svg"'))
    open(os.path.join(OUT, ".nojekyll"), "w").close()
    with open(os.path.join(OUT, f"{INDEXNOW_KEY}.txt"), "w") as f:
        f.write(INDEXNOW_KEY)
    urls = []

    # Home
    body = f"""<section class="hero"><div class="wrap"><div>
<h1>The free loyalty card your customers already carry.</h1>
<p class="lead">Stamp Card is a digital stamp card for coffee shops, bars, restaurants and takeaways. No app. No subscription. No paper cards in the washing machine.</p>
<ul class="pills"><li>No app to download</li><li>No monthly fees</li><li>Your own branding</li><li>Free and open source</li></ul>
<div class="ctas"><a class="btn" href="{{root}}get-it/">Get Stamp Card</a><a class="btn alt" href="#how">See how it works</a></div>
</div>{phone("Your Shop", 7, "a free coffee")}</div></section>
{HOW}{WHY}{OPTIONS}{venue_grid()}{faq_html()}{cta_band()}"""
    urls.append(page("index.html", "Stamp Card – free digital loyalty card. No app, no subscription.",
                     "Free digital stamp card for coffee shops, bars, restaurants and takeaways. Customers scan a QR code. No app, no monthly fees, your branding. Open source.",
                     body, [APP_LD, faq_ld()]))

    # Venue pages
    for slug, name, plural, reward, earn, hook, tip in VENUES:
        others = [v for v in VENUES if v[0] != slug][:6]
        more = "".join(f'<a class="venue" href="{{root}}for/{v[0]}/">{esc(v[2][0].upper()+v[2][1:])}</a>' for v in others)
        title_plural = plural[0].upper() + plural[1:]
        body = f"""<section class="hero"><div class="wrap"><div>
<div class="crumbs"><a href="{{root}}">Stamp Card</a> › {esc(title_plural)}</div>
<h1>A free loyalty card for {esc(plural)}.</h1>
<p class="lead">{esc(hook)} Stamp Card is a digital stamp card that lives on your customers' phones. No app, no monthly fees.</p>
<ul class="pills"><li>Stamp {esc(earn)}</li><li>Reward with {esc(reward)}</li><li>No app</li><li>Free</li></ul>
<div class="ctas"><a class="btn" href="{{root}}get-it/">Get it for my {esc(name.lower())}</a><a class="btn alt" href="#how">How it works</a></div>
</div>{phone("Your " + name, 6, reward.replace("a ", "", 1))}</div></section>
<section><div class="wrap"><div class="grid3">
<div class="card"><h3>Why {esc(plural)} use it</h3>Paper cards get lost and forgotten. Loyalty apps cost a monthly fee and make customers download something. Stamp Card does neither. It's a link on their phone.</div>
<div class="card"><h3>Quick at the till</h3>Staff scan the customer's card with their phone camera and tap +1. It takes about two seconds, even in a rush.</div>
<div class="card"><h3>Tip for {esc(plural)}</h3>{esc(tip)}</div>
</div></div></section>
{HOW}{OPTIONS}
<section class="alt"><div class="wrap"><h2>Also used by</h2><div class="grid4">{more}</div></div></section>
{faq_html()}{cta_band(f"Give your regulars {reward}.")}"""
        urls.append(page(f"for/{slug}/index.html",
                         f"Free loyalty card for {plural} – no app, no fees | Stamp Card",
                         f"A free digital stamp card for {plural}. Customers collect stamps on their phone and earn {reward}. No app, no subscription, your branding.",
                         body, [APP_LD, faq_ld()]))

    # Country pages
    for slug, cname, tw, cw, line in COUNTRIES:
        title_venues = f"cafés, bars, restaurants and {tw} shops"
        body = f"""<section class="hero"><div class="wrap"><div>
<div class="crumbs"><a href="{{root}}">Stamp Card</a> › {esc(cname[0].upper()+cname[1:])}</div>
<h1>A free digital {esc(cw)} for {esc(title_venues)} in {esc(cname)}.</h1>
<p class="lead">{esc(line)} Swap the paper {esc(cw)} for one that lives on your customers' phones. No app, no subscription.</p>
<ul class="pills"><li>No app</li><li>No monthly fees</li><li>Works on any phone</li><li>Free</li></ul>
<div class="ctas"><a class="btn" href="{{root}}get-it/">Get Stamp Card</a><a class="btn alt" href="#how">How it works</a></div>
</div>{phone("Your Shop", 8, "a free coffee")}</div></section>
{HOW}{WHY}{OPTIONS}{venue_grid()}{faq_html()}{cta_band()}"""
        urls.append(page(f"in/{slug}/index.html",
                         f"Free digital {cw} app in {cname} – no subscription | Stamp Card",
                         f"Free digital {cw} for {title_venues} in {cname}. Customers scan a QR code, no app needed. No monthly fees. Open source.",
                         body, [APP_LD, faq_ld()]))

    # Get it (form)
    choice = lambda v, t, d: f'<label class="choice"><input type="radio" name="choice" value="{esc(t)}" data-k="{v}" required><b>{esc(t)}</b><br><span style="color:var(--muted)">{esc(d)}</span></label>'
    vopts = "".join(f"<option>{esc(v[1])}</option>" for v in VENUES) + "<option>Other</option>"
    copts = "".join(f"<option>{esc(c[1].replace('the ', '').upper() if len(c[1])<8 else c[1])}</option>" for c in COUNTRIES) + "<option>Other</option>"
    copts = "<option>UK</option><option>US</option><option>Australia</option><option>Canada</option><option>Ireland</option><option>New Zealand</option><option>Other</option>"
    body = f"""<section class="hero"><div class="wrap" style="display:block;max-width:640px">
<h1>Get Stamp Card for your venue.</h1>
<p class="lead">No app. No subscription. Pick an option, leave your email, and we'll send you everything you need.</p>
<form id="f" action="https://api.web3forms.com/submit" method="POST" class="card">
<input type="hidden" name="access_key" value="{KEY}">
<input type="hidden" name="subject" value="Stamp Card enquiry (website)">
<input type="hidden" name="from_name" value="Stamp Card website">
<input type="hidden" name="redirect" value="{BASE}thanks/">
<input type="checkbox" name="botcheck" style="display:none" tabindex="-1" autocomplete="off">
<div class="field"><label>What would you like?</label>
{choice("free", "Free – I'll set it up myself", "Send me the link to the code and setup guide.")}
{choice("kit", "Guided kit – £25", "Step-by-step guide to build it yourself with Claude, plus posters.")}
{choice("done", "Done for you – £199", "You set it up, branded and ready to scan.")}
{choice("curious", "Just curious", "Tell me more.")}
</div>
<div class="field"><label for="email">Your email</label><input id="email" type="email" name="email" required autocomplete="email"></div>
<div class="field"><label for="venue">Venue name <span style="font-weight:400;color:var(--muted)">(optional)</span></label><input id="venue" type="text" name="venue_name" maxlength="120"></div>
<div class="field"><label for="vt">Type of venue</label><select id="vt" name="venue_type">{vopts}</select></div>
<div class="field"><label for="ct">Country</label><select id="ct" name="country">{copts}</select></div>
<div class="err" id="err">Please pick an option.</div>
<button class="btn" type="submit" id="go">Send</button>
<p style="font-size:13px;color:var(--muted);margin-top:12px">We'll only use your email to reply. See our <a href="{{root}}privacy/">privacy note</a>.</p>
</form></div></section>
<script>
(function(){{
 var f=document.getElementById('f'),err=document.getElementById('err'),go=document.getElementById('go');
 var want=new URLSearchParams(location.search).get('want');
 if(want){{var r=f.querySelector('input[data-k="'+want+'"]');if(r)r.checked=true;}}
 f.addEventListener('submit',function(e){{
  e.preventDefault();
  var c=f.querySelector('input[name=choice]:checked');
  if(!c){{err.style.display='block';return;}}
  err.style.display='none';
  var v=f.venue.value.trim()||'No venue name';
  var data=new FormData(f);
  data.set('subject','Stamp Card enquiry – '+c.value.split(' – ')[0]+' – '+v+' ('+f.country.value+')');
  data.set('replyto',f.email.value);
  var o={{}};o['What they want']=c.value;data.forEach(function(val,k){{if(k!=='choice')o[k]=val;}});
  o.page=document.referrer||location.href;
  go.disabled=true;go.textContent='Sending…';
  fetch('https://api.web3forms.com/submit',{{method:'POST',headers:{{'Content-Type':'application/json',Accept:'application/json'}},body:JSON.stringify(o)}})
  .then(function(r){{return r.json()}}).then(function(j){{
    if(j.success){{location.href='{{root}}thanks/';}}else{{throw 0}}
  }}).catch(function(){{go.disabled=false;go.textContent='Send';err.textContent='Sorry, that didn\\'t send. Please try again.';err.style.display='block';}});
 }});
}})();
</script>"""
    urls.append(page("get-it/index.html", "Get Stamp Card for your venue | Stamp Card",
                     "Get Stamp Card for your café, bar, restaurant or takeaway. Free to set up yourself, a £25 guided kit, or done for you.", body))

    page("thanks/index.html", "Thanks | Stamp Card", "Thanks for your enquiry.",
         """<section class="hero"><div class="wrap" style="display:block;max-width:640px">
<h1>Thanks! We'll email you within 24 hours.</h1>
<p class="lead">Keep an eye on your inbox, and check your junk folder just in case.</p>
<a class="btn alt" href="{root}">Back to Stamp Card</a></div></section>""")

    urls.append(page("privacy/index.html", "Privacy | Stamp Card", "How the Stamp Card website handles your information.",
         """<section><div class="wrap" style="max-width:720px">
<h1>Privacy</h1>
<p>This website doesn't use cookies or tracking.</p>
<p>If you fill in the enquiry form, we receive your email address and anything else you type in. We use it only to reply to your enquiry. We don't add you to a mailing list and we don't sell or share your details.</p>
<p>The form is delivered by Web3Forms, a form-to-email service. Want your enquiry deleted? Reply to any email from us and ask.</p>
<p>The Stamp Card app itself is run by each venue on its own account. Each venue is responsible for the data in its own app.</p>
</div></section>"""))

    page("404.html", "Page not found | Stamp Card", "Page not found.",
         """<section class="hero"><div class="wrap" style="display:block"><h1>That page doesn't exist.</h1>
<a class="btn" href="/stamp-card/">Go to Stamp Card</a></div></section>""")

    # sitemap + robots
    sm = "".join(f"<url><loc>{u}</loc><lastmod>{TODAY}</lastmod></url>" for u in urls)
    with open(os.path.join(OUT, "sitemap.xml"), "w") as f:
        f.write(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sm}</urlset>')
    with open(os.path.join(OUT, "robots.txt"), "w") as f:
        f.write(f"User-agent: *\nAllow: /\nSitemap: {BASE}sitemap.xml\n")
    with open(os.path.join(OUT, "urls.txt"), "w") as f:
        f.write("\n".join(urls) + "\n")
    print(len(urls), "indexable pages")


if __name__ == "__main__":
    build()
