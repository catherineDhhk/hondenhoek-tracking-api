export const config = { runtime: "nodejs" };

/* ============================================================================
   1) HELPERS
============================================================================ */

/* -------------------------
   POSTNL SCRAPER (incl. tijdslot)
-------------------------- */
async function scrapePostNL(code) {
  try {
    const url = `https://jouw.postnl.nl/track-and-trace/api/track?barcode=${code}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    });

    const data = await res.json();
    if (!data) return { status: "unknown" };

    const phase = data.phase ?? "UNKNOWN";

    let day = null;
    let window = null;

    if (data?.timeFrame?.start && data?.timeFrame?.end) {
      const start = new Date(data.timeFrame.start);
      const end = new Date(data.timeFrame.end);

      const dayNames = [
        "zondag",
        "maandag",
        "dinsdag",
        "woensdag",
        "donderdag",
        "vrijdag",
        "zaterdag",
      ];

      day = dayNames[start.getDay()];
      window =
        start.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" }) +
        " – " +
        end.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
    }

    if (phase === "DELIVERED")
      return {
        status: "bezorgd",
        deliveredDate: data.deliveryDate ?? null,
        delivery_day: day,
        delivery_window: window,
      };

    if (phase === "IN_TRANSPORT")
      return {
        status: "onderweg",
        deliveredDate: null,
        delivery_day: day,
        delivery_window: window,
      };

    if (phase === "COLLECTED")
      return {
        status: "verzonden",
        deliveredDate: null,
        delivery_day: day,
        delivery_window: window,
      };

    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

/* -------------------------
   BPOST SCRAPER
-------------------------- */
async function scrapeBpost(code) {
  try {
    const url = `https://api.bpost.cloud/track/items?itemIdentifier=${code}`;
    const res = await fetch(url);
    const json = await res.json();

    const phase = json?.item?.status?.phase;
    if (phase === "DELIVERED")
      return {
        status: "bezorgd",
        deliveredDate: json.item.status.date ?? null,
      };

    if (phase) return { status: "onderweg" };

    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

/* -------------------------
   FALLBACK 4–7 werkdagen
-------------------------- */
function fallbackWindow(date) {
  const start = new Date(date);
  const end = new Date(date);

  start.setDate(start.getDate() + 4);
  end.setDate(end.getDate() + 7);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

/* ============================================================================
   2) MAIN HANDLER
============================================================================ */

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { order, email } = req.query;
    if (!order || !email)
      return res.status(400).json({ error: "Parameters ontbreken." });

    const clean = order.replace("#", "").trim().toUpperCase();

    /* -------------------------
       SHOPIFY FETCH
    -------------------------- */
    const shop = process.env.SHOPIFY_DOMAIN;
    const token = process.env.SHOPIFY_TOKEN;

    const shopRes = await fetch(
      `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=50`,
      {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await shopRes.json();
    if (!data.orders) return res.status(500).json({ error: "Shopify API fout." });

    const o = data.orders.find(
      (x) =>
        String(x.order_number) === clean ||
        x.name?.replace("#", "") === clean
    );

    if (!o) return res.status(404).json({ error: "Geen bestelling gevonden." });

    const mail = email.toLowerCase();
    if (
      o.email?.toLowerCase() !== mail &&
      o.customer?.email?.toLowerCase() !== mail
    ) {
      return res.status(401).json({ error: "E-mailadres komt niet overeen." });
    }

    /* -------------------------
       FULFILLMENT CHECK
    -------------------------- */

    const fulfillment = o.fulfillments?.[0] ?? null;
    const tracking = fulfillment?.tracking_number ?? null;

    // 🟡 CASE 1 — Helemaal geen fulfillment → bestelling nog NIET verwerkt
    if (!fulfillment) {
      return res.json({
        order_number: clean,
        customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
        items: o.line_items,
        status: "besteld",
        expected: null,
      });
    }

    // 🟡 CASE 2 — Fulfillment bestaat maar geen tracking → "verwerkt"
    if (fulfillment && !tracking) {
      return res.json({
        order_number: clean,
        customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
        items: o.line_items,
        status: "verwerkt",
        expected: "Uw bestelling wordt klaargemaakt voor verzending.",
      });
    }

    /* -------------------------
       TRACKING SCRAPE
    -------------------------- */

    let carrier = "onbekend";
    let result = { status: "unknown" };

    if (tracking.endsWith("NL")) {
      carrier = "postnl";
      result = await scrapePostNL(tracking);

      if (result.status === "unknown") {
        const bp = await scrapeBpost(tracking);
        if (bp.status !== "unknown") {
          carrier = "bpost";
          result = bp;
        }
      }
    } else if (tracking.endsWith("BE")) {
      carrier = "bpost";
      result = await scrapeBpost(tracking);
    }

    /* -------------------------
       UNKNOWN HANDLING
    -------------------------- */

    if (result.status === "unknown") {
      const fDate = new Date(fulfillment.created_at);

      const hoursSince = (Date.now() - fDate.getTime()) / 36e5;

      if (hoursSince < 48) {
        return res.json({
          order_number: clean,
          customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
          items: o.line_items,
          tracking,
          carrier,
          status: "verzonden-wachten",
          expected: {
            message: "Eerste trackingupdate wordt binnen 24–48 uur verwacht.",
          },
        });
      }

      const win = fallbackWindow(fDate);
      return res.json({
        order_number: clean,
        customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
        items: o.line_items,
        tracking,
        carrier,
        status: "onderweg",
        expected: {
          start: win.start,
          end: win.end,
        },
      });
    }

    /* -------------------------
       SUCCESS CASE
    -------------------------- */

    return res.json({
      order_number: clean,
      customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
      items: o.line_items,
      tracking,
      carrier,
      status: result.status,
      deliveredDate: result.deliveredDate ?? null,
      delivery_day: result.delivery_day ?? null,
      delivery_window: result.delivery_window ?? null,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
