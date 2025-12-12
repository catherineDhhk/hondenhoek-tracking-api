export default async function handler(req, res) {
  try {
    const { code } = req.query;

    const api = `https://api.bpost.cloud/track/items?itemIdentifier=${code}`;

    const json = await fetch(api).then((r) => r.json());

    let delivered = json?.item?.status?.phase === "DELIVERED";

    return res.json({
      carrier: "bpost",
      status: delivered ? "bezorgd" : "onderweg",
      deliveredDate: json?.item?.status?.date || null,
    });
  } catch (err) {
    return res.json({ carrier: "bpost", status: "onbekend" });
  }
}
