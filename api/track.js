export const config = { runtime: "nodejs" };

/* -------------------------
   HELPERS
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
    if (!data || !data.phase) return { status: "unknown", deliveredDate: null };

    if (data.phase === "DELIVERED")
      return { status: "bezorgd", deliveredDate: data.deliveryDate ?? null };

    if (data.phase === "IN_TRANSPORT") return { status: "onderweg", deliveredDate: null };
    if (data.phase === "COLLECTED") return { status: "verzonden", deliveredDate: null };

    return { status: "unknown", deliveredDate: null };
  } catch (e) {
    return { status: "unknown", deliveredDate: null };
  }
}

async function scrapeBpost(code) {
  try {
    const url = `https://api.bpost.cloud/track/items?itemIdentifier=${code}`;
    const res = await fetch(url);
    const json = await res.json();

    const phase = json?.item?.status?.phase;
    if (!phase) return { status: "unknown", deliveredDate: null };

    if (phase === "DELIVERED")
      return { status: "bezorgd", deliveredDate: json.item.status.date ?? null };

    return { status: "onderweg", deliveredDate: null };
  } catch (e) {
    return { status: "unknown", deliveredDate: null };
  }
}

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

/* -------------------------
   MAIN HANDLER
-------------------------- */

export default async function handler(req, res) {
  // CORS FIX — hoort bovenaan!
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { order, email } = req.query;
    if (!order || !email)
      return res.status(400).json({ error: "Parameters ontbreken." });

    const clean = order.replace("#", "").trim().toUpperCase();

    const shop = process.env.SHOPIFY_DOMAIN;
    const token = process.env.SHOPIFY_TOKEN;

    const shopRes = await fetch(
      `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=30`,
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

    // E-mail check
    const mail = email.toLowerCase();
    if (
      o.email?.toLowerCase() !== mail &&
      o.customer?.email?.toLowerCase() !== mail
    ) {
      return res.status(401).json({ error: "E-mailadres komt niet overeen." });
    }

    const fulfillment = o.fulfillments?.[0] ?? null;
    const tracking = fulfillment?.tracking_number ?? null;

    // Geen tracking = eco fallback (op basis van besteldatum)
    if (!tracking) {
      const win = fallbackWindow(o.created_at);
      return res.json({
        order_number: clean,
        customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
        items: o.line_items,
        status: "verzonden",
        expected: `Levering tussen ${win.start} en ${win.end}`,
      });
    }

    // Bepaal carrier
    let carrier = "onbekend";
    let result = null;

    if (tracking.endsWith("NL")) {
      carrier = "postnl";
      result = await scrapePostNL(tracking);

      // fallback naar Bpost
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
    } else {
      result = { status: "unknown", deliveredDate: null };
    }

    // Unknown → verzonden-wachten (0–48h) → eco fallback (>48h)
    if (result.status === "unknown") {
      const fDate = fulfillment?.created_at
        ? new Date(fulfillment.created_at)
        : new Date(o.created_at);

      const hoursSince = (Date.now() - fDate.getTime()) / 36e5;

      if (hoursSince < 48) {
        return res.json({
          order_number: clean,
          customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
          items: o.line_items,
          tracking,
          carrier,
          status: "verzonden-wachten",
          expected: "Trackinginformatie wordt binnen 24–48 uur bijgewerkt",
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
        expected: `Levering tussen ${win.start} en ${win.end}`,
      });
    }

    // Normaal antwoord
    return res.json({
      order_number: clean,
      customer_name: `${o.customer.first_name} ${o.customer.last_name}`,
      items: o.line_items,
      tracking,
      carrier,
      status: result.status,
      deliveredDate: result.deliveredDate ?? null,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
