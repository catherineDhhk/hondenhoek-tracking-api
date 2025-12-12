export default async function handler(req, res) {
  try {
    const { code } = req.query;

    const url = `https://jouw.postnl.nl/track-and-trace/${code}`;

    const html = await fetch(url).then((r) => r.text());

    let delivered = /bezorgd/i.test(html);
    let inTransit = /onderweg|gesorteerd/i.test(html);

    let deliveredDate = null;

    const m = html.match(/(\d{2}-\d{2}-\d{4})/);
    if (m) deliveredDate = m[1];

    return res.json({
      carrier: "postnl",
      status: delivered ? "bezorgd" : inTransit ? "onderweg" : "onbekend",
      deliveredDate,
      raw: undefined,
    });
  } catch (err) {
    return res.json({ carrier: "postnl", status: "onbekend" });
  }
}
