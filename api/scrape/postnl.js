export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    const { code } = req.query;

    if (!code) return res.json({ error: "missing code" });

    const url = `https://jouw.postnl.nl/track-and-trace/api/track?barcode=${code}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    const data = await response.json();

    if (!data || !data.phase) {
      return res.json({
        carrier: "postnl",
        status: "onbekend",
        deliveredDate: null,
      });
    }

    let status = "onbekend";
    let deliveredDate = null;

    if (data.phase === "DELIVERED") {
      status = "bezorgd";
      deliveredDate = data.deliveryDate || null;
    } else if (data.phase === "IN_TRANSPORT") {
      status = "onderweg";
    } else if (data.phase === "COLLECTED") {
      status = "verzonden";
    }

    return res.json({
      carrier: "postnl",
      status,
      deliveredDate,
      raw: data,
    });
  } catch (err) {
    return res.json({
      carrier: "postnl",
      status: "onbekend",
      deliveredDate: null,
    });
  }
}
