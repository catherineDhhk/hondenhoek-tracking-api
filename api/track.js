export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { order, email } = req.query;

    if (!order || !email) {
      return res.status(400).json({ error: "Missing parameters." });
    }

    const cleanOrder = String(order).replace("#", "").trim().toUpperCase();

    const url =
      `https://${process.env.SHOP}.myshopify.com/admin/api/2024-10/orders.json?status=any&limit=50&fields=` +
      `id,name,order_number,customer,line_items,fulfillments,created_at,fulfillment_status,email`;

    const shopRes = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": process.env.TOKEN,
        "Content-Type": "application/json"
      }
    });

    const data = await shopRes.json();
    if (!data.orders) return res.status(500).json({ error: "Shopify API unreachable." });

    const orderMatch = data.orders.find(
      o => String(o.order_number) === cleanOrder || o.name?.replace("#", "") === cleanOrder
    );

    if (!orderMatch) {
      return res.status(404).json({ error: "Geen bestelling gevonden." });
    }

    const emailMatch =
      orderMatch.email?.toLowerCase() === email.toLowerCase() ||
      orderMatch.customer?.email?.toLowerCase() === email.toLowerCase();

    if (!emailMatch) {
      return res.status(401).json({ error: "E-mailadres komt niet overeen." });
    }

    const items = orderMatch.line_items.map(i => ({
      title: i.title,
      quantity: i.quantity,
      image: i.image?.src || null
    }));

    const fulfillment = orderMatch.fulfillments?.[0] ?? null;

    let status = "besteld";
    let deliveredDate = null;

    if (orderMatch.fulfillment_status === "fulfilled" && fulfillment?.updated_at) {
      status = "bezorgd";
      deliveredDate = new Date(fulfillment.updated_at).toISOString().slice(0, 10);
    }

    return res.json({
      order_number: orderMatch.name.replace("#", ""),
      customer_name: `${orderMatch.customer?.first_name ?? ""} ${orderMatch.customer?.last_name ?? ""}`.trim(),
      items,
      status,
      deliveredDate
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
