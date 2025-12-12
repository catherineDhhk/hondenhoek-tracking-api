export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  try {
    return res.status(200).json({
      ok: true,
      message: "Track API werkt correct."
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
