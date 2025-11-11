import { NextResponse } from "next/server";
import { Resend } from "resend";

function buildResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

export async function POST(req) {
  const resend = buildResendClient();

  if (!resend) {
    return NextResponse.json({ ok: false, error: "RESEND_API_KEY not configured." }, { status: 400 });
  }

  const from = process.env.FROM_EMAIL;
  const to = process.env.OWNER_EMAIL;

  if (!from || !to) {
    return NextResponse.json(
      { ok: false, error: "FROM_EMAIL and OWNER_EMAIL must be configured." },
      { status: 400 }
    );
  }

  let payload;
  try {
    payload = await req.json();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload.", details: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }

  const { form = {}, videoUrls = [], imageUrl } = payload || {};

  const formatLabel = (key) =>
    key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();

  const formatValue = (value) => {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  const formRows = Object.entries(form)
    .map(
      ([key, value]) => `
        <tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; background:#f8fafc; font-weight: 600; width: 35%;">
            ${formatLabel(key)}
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0;">
            <pre style="margin: 0; font: 14px/1.5 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; white-space: pre-wrap;">${formatValue(
              value
            )}</pre>
          </td>
        </tr>
      `
    )
    .join("");

  const videoList =
    videoUrls.length > 0
      ? videoUrls
          .map(
            (url, index) => `
              <li style="margin-bottom: 6px;">
                <a href="${url}" style="color: #0c68ff; text-decoration: none;">Video ${index + 1}</a>
                <div style="font-size: 12px; color: #64748b; word-break: break-all;">${url}</div>
              </li>
            `
          )
          .join("")
      : `<li style="color: #94a3b8;">No videos uploaded</li>`;

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background:#f1f5f9; padding:32px;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 12px 35px rgba(15,23,42,0.12);">
        <div style="background:linear-gradient(135deg,#1d1b8f,#401b96); padding:24px 28px;">
          <h1 style="margin:0; color:#ffffff; font-size:22px;">New Upload</h1>
          <p style="margin:8px 0 0; color:rgba(255,255,255,0.78); font-size:14px;">Submitted at ${new Date().toLocaleString()}</p>
        </div>

        <div style="padding:28px;">
          <h2 style="margin:0 0 16px; font-size:18px; color:#0f172a;">Player &amp; Contact Details</h2>
          <table style="border-collapse: collapse; width: 100%; margin-bottom: 28px; border-radius: 8px; overflow: hidden;">
            <tbody>
              ${formRows}
            </tbody>
          </table>

          <h2 style="margin:0 0 12px; font-size:18px; color:#0f172a;">Submitted Files</h2>

          <div style="margin-bottom: 20px;">
            <h3 style="margin:0 0 8px; font-size:16px; color:#1e293b;">Player Image</h3>
            ${
              imageUrl
                ? `<a href="${imageUrl}" style="display:inline-block; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0;">
                    <img src="${imageUrl}" alt="Player image" style="display:block; width:220px; height:auto;" />
                  </a>
                  <div style="font-size:12px; color:#64748b; margin-top:6px; word-break:break-all;">${imageUrl}</div>`
                : `<p style="margin:0; color:#94a3b8;">No image uploaded</p>`
            }
          </div>

          <div>
            <h3 style="margin:0 0 8px; font-size:16px; color:#1e293b;">Video Files</h3>
            <ul style="margin:0; padding-left: 18px; color:#0f172a; font-size:14px;">
              ${videoList}
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    const response = await resend.emails.send({
      from,
      to,
      subject: "New video submission",
      html,
    });

    if (response.error) {
      return NextResponse.json(
        {
          ok: false,
          error: response.error?.message || "Resend reported an error.",
          data: response,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, id: response.data?.id });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to send email with Resend.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
