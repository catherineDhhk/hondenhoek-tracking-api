export default async function handler(req, res) {
  try {
    const { order, email } = req.query;

    if (!order || !email) {
      return res.status(400).json({ error: "Missing parameters." });
    }

    const shopDomain = process.env.SHOPIFY_DOMAIN;
    const token = process.env.SHOPIFY_TOKEN;

    // 1. HAAL ORDERS OP
    const url =
      `https://${shopDomain}/admin/api/2024-10/orders.json?status=any&limit=20`;

    const shopifyRes = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
    });

    const data = await shopifyRes.json();

    if (!data.orders) {
      return res.status(500).json({ error: "Shopify API unreachable." });
    }

    const clean = order.replace("#", "").trim().toUpperCase();

    const orderMatch = data.orders.find(
      (o) =>
        String(o.order_number) === clean ||
        o.name?.replace("#", "") === clean
    );

    if (!orderMatch) {
      return res.status(404).json({ error: "Geen bestelling gevonden." });
    }

    // 2. EMAIL CHECK
    if (
      orderMatch.email?.toLowerCase() !== email.toLowerCase() &&
      orderMatch.customer?.email?.toLowerCase() !== email.toLowerCase()
    ) {
      return res.status(401).json({ error: "E-mailadres komt niet overeen." });
    }

    // 3. TRACKINGNUMMER
    const fulfillment = orderMatch.fulfillments?.[0];
    const tracking = fulfillment?.tracking_number || null;

    let status = "besteld";
    let deliveredDate = null;

    // FALLBACK: Als geen tracking → standaard levertijd
    if (!tracking) {
      return res.json({
        order_number: clean,
        customer_name:
          `${orderMatch.customer.first_name} ${orderMatch.customer.last_name}`,
        status: "verzonden",
        expected: "4–7 werkdagen (zonder tracking info)",
      });
    }

    // 4. BEPAAL CARRIER
    let carrier = "unknown";

    if (tracking.endsWith("NL")) carrier = "postnl";
    if (tracking.endsWith("BE")) carrier = "bpost";

    // 5. SCRAPER CALL
    let carrierData = null;

    if (carrier === "postnl") {
      const r = await fetch(
        `${process.env.BASE_URL}/api/scrape/postnl?code=${tracking}`
      );
      carrierData = await r.json();
    }

    if (carrier === "bpost") {
      const r = await fetch(
        `${process.env.BASE_URL}/api/scrape/bpost?code=${tracking}`
      );
      carrierData = await r.json();
    }

    return res.json({
      order_number: clean,
      customer_name:
        `${orderMatch.customer.first_name} ${orderMatch.customer.last_name}`,
      items: orderMatch.line_items.map((i) => ({
        title: i.title,
        quantity: i.quantity,
        image: i.image || null,
      })),
      tracking,
      carrier,
      status: carrierData?.status || "onbekend",
      deliveredDate: carrierData?.deliveredDate || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
