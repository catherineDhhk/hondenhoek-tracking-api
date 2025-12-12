export const config = { runtime: "nodejs" };

async function scrapePostNL(code) {
  try {
    const url = `https://jouw.postnl.nl/track-and-trace/api/track?barcode=${code}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" }
    });

    const data = await res.json();

    if (!data || !data.phase) {
      return { status: "unknown", deliveredDate: null };
    }

    if (data.phase === "DELIVERED") {
      return {
        status: "bezorgd",
        deliveredDate: data.deliveryDate || null
      };
    }

    if (data.phase === "IN_TRANSPORT") {
      return { status: "onderweg", deliveredDate: null };
    }

    if (data.phase === "COLLECTED") {
      return { status: "verzonden", deliveredDate: null };
    }

if (result.status === "unknown") {
  const fDate = new Date(fulfillment.created_at);
  const fw = fallbackWindow(fDate);

  // Minder dan 48 uur na verzending → status wordt bijgewerkt
  const hoursSince = (Date.now() - fDate.getTime()) / 36e5;

  if (hoursSince < 48) {
    return res.json({
      order_number: clean,
      customer_name:
        `${o.customer.first_name} ${o.customer.last_name}`,
      items: o.line_items,
      tracking,
      carrier,
      status: "verzonden-wachten",
      expected: "Trackinginformatie wordt binnen 24–48 uur bijgewerkt"
    });
  }

  // Meer dan 48 uur → eco-levering tonen
  return res.json({
    order_number: clean,
    customer_name:
      `${o.customer.first_name} ${o.customer.last_name}`,
    items: o.line_items,
    tracking,
    carrier,
    status: "onderweg",
    expected: `Eco levering tussen ${fw.start} en ${fw.end}`
  });
}

}

async function scrapeBpost(code) {
  try {
    const url = `https://api.bpost.cloud/track/items?itemIdentifier=${code}`;
    const res = await fetch(url);
    const json = await res.json();

    const phase = json?.item?.status?.phase;

    if (!phase) return { status: "unknown", deliveredDate: null };

    if (phase === "DELIVERED") {
      return {
        status: "bezorgd",
        deliveredDate: json.item.status.date || null
      };
    }

    return { status: "onderweg", deliveredDate: null };
  } catch (e) {
    return { status: "unknown", deliveredDate: null };
  }
}

// fallback levertijd
function fallbackWindow(fulfillmentDate) {
  const start = new Date(fulfillmentDate);
  const end = new Date(fulfillmentDate);

  start.setDate(start.getDate() + 4);
  end.setDate(end.getDate() + 7);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

export default async function handler(req, res) {
  try {
    const { order, email } = req.query;

    const shop = process.env.SHOPIFY_DOMAIN;
    const token = process.env.SHOPIFY_TOKEN;

    const clean = order.replace("#", "").trim().toUpperCase();

    // 1. FETCH SHOPIFY ORDERS
    const url =
      `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=30`;

    const shopRes = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      }
    });

    const data = await shopRes.json();

    const o = data.orders.find(
      (x) =>
        String(x.order_number) === clean ||
        x.name?.replace("#", "") === clean
    );

    if (!o) return res.status(404).json({ error: "Geen bestelling gevonden" });

    // 2. EMAIL CHECK
    const mail = email.toLowerCase();
    if (
      o.email?.toLowerCase() !== mail &&
      o.customer?.email?.toLowerCase() !== mail
    ) {
      return res.status(401).json({ error: "E-mailadres komt niet overeen" });
    }

    const fulfillment = o.fulfillments?.[0] || null;
    const tracking = fulfillment?.tracking_number || null;

    // 3. GEEN TRACKING → fallback
    if (!tracking) {
      const created = new Date(o.created_at);
      const fw = fallbackWindow(created);

      return res.json({
        order_number: clean,
        customer_name:
          `${o.customer.first_name} ${o.customer.last_name}`,
        items: o.line_items,
        status: "verzonden",
        expected: `Levering tussen ${fw.start} en ${fw.end}`
      });
    }

    // 4. SCRAPERS
    let carrier = "onbekend";
    let result = null;

    if (tracking.endsWith("NL")) {
      carrier = "postnl";
      result = await scrapePostNL(tracking);

      // fallback naar bpost indien onbekend
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

    // 5. FALLBACK RULE: UNKNOWN → eco levertijd
    if (result.status === "unknown") {
      const fDate = new Date(fulfillment.created_at);
      const fw = fallbackWindow(fDate);

      return res.json({
        order_number: clean,
        customer_name:
          `${o.customer.first_name} ${o.customer.last_name}`,
        items: o.line_items,
        tracking,
        carrier,
        status: "onderweg",
        expected: `Levering tussen ${fw.start} en ${fw.end}`
      });
    }

    // 6. NORMAL RETURN
    return res.json({
      order_number: clean,
      customer_name:
        `${o.customer.first_name} ${o.customer.last_name}`,
      items: o.line_items,
      tracking,
      carrier,
      status: result.status,
      deliveredDate: result.deliveredDate || null
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
