import { NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "node:crypto";

function buildResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function isValidEmail(value) {
  if (typeof value !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildFromAddress() {
  let fromEmail = typeof process.env.FROM_EMAIL === "string" ? process.env.FROM_EMAIL.trim() : "";
  const fromName = typeof process.env.FROM_NAME === "string" ? process.env.FROM_NAME.trim() : "";

  if (!fromEmail) return null;

  if (
    (fromEmail.startsWith('"') && fromEmail.endsWith('"')) ||
    (fromEmail.startsWith("'") && fromEmail.endsWith("'"))
  ) {
    fromEmail = fromEmail.slice(1, -1).trim();
  }

  if (isValidEmail(fromEmail)) {
    return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  }

  const match = fromEmail.match(/^(.+?)\s*<([^<>]+)>$/);
  if (match) {
    const namePart = match[1].trim();
    const emailPart = match[2].trim();

    if (isValidEmail(emailPart)) {
      return namePart ? `${namePart} <${emailPart}>` : emailPart;
    }
  }

  return null;
}

export async function POST(req) {
  const resend = buildResendClient();

  if (!resend) {
    return NextResponse.json({ ok: false, error: "RESEND_API_KEY not configured." }, { status: 400 });
  }

  const staticFrom = buildFromAddress();
  const ownerEmail = typeof process.env.OWNER_EMAIL === "string" ? process.env.OWNER_EMAIL.trim() : "";

  if (!staticFrom) {
    return NextResponse.json(
      { ok: false, error: "FROM_EMAIL must be a valid email or formatted as 'Name <email@example.com>'." },
      { status: 400 }
    );
  }

  if (!isValidEmail(ownerEmail)) {
    return NextResponse.json(
      { ok: false, error: "OWNER_EMAIL must be configured with a valid email address." },
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

  const { form = {}, videoUrls = [], imageUrls = [] } = payload || {};
  const submitterEmail = typeof form.email === "string" ? form.email.trim() : "";
  const replyTo = isValidEmail(submitterEmail) ? submitterEmail : undefined;
  const ticketId = crypto.randomUUID().slice(0, 8);
  const subject = `New video submission${submitterEmail ? ` from ${submitterEmail}` : ""} · #${ticketId}`;

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
              <li style="margin-bottom: 12px; list-style: none;">
                <div style="font-weight: 600; color:#1e293b; margin-bottom: 4px;">Video ${index + 1}</div>
                <a href="${url}" style="display:inline-block; color: #0c68ff; text-decoration: none;">${url}</a>
              </li>
            `
          )
          .join("")
      : `<li style="color: #94a3b8; list-style:none;">No videos uploaded</li>`;

  const imageList =
    imageUrls.length > 0
      ? imageUrls
          .map(
                (url, index) => `
              <li style="margin-bottom: 12px; list-style: none;">
                <div style="font-weight: 600; color:#1e293b; margin-bottom: 6px;">Image ${index + 1}</div>
                <a href="${url}" style="display:inline-block; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0;">
                  <img src="${url}" alt="Uploaded image ${index + 1}" style="display:block; width:220px; height:auto;" />
                </a>
                <div style="font-size: 12px; color: #64748b; margin-top: 6px; word-break: break-all;">${url}</div>
              </li>
            `
          )
          .join("")
      : `<li style="color: #94a3b8; list-style:none;">No images uploaded</li>`;

  const html = `
    <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background:#f1f5f9; padding:32px;">
      <div style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 12px 35px rgba(15,23,42,0.12);">
        <div style="background:linear-gradient(135deg,#1d1b8f,#401b96); padding:24px 28px;">
          <h1 style="margin:0; color:#ffffff; font-size:22px;">New Upload</h1>
          <p style="margin:8px 0 0; color:rgba(255,255,255,0.78); font-size:14px;">Submitted at ${new Date().toLocaleString()}</p>
        </div>

        <div style="padding:28px;">
          <h2 style="margin:0 0 16px; font-size:18px; color:#0f172a;">Player &amp; Contact Details</h2>
          ${
            submitterEmail
              ? `<p style="margin:0 0 12px; font-size:14px; color:#1e293b;">
                    <strong style="display:inline-block; width:110px;">Email:</strong>
                    <a href="mailto:${submitterEmail}" style="color:#0c68ff; text-decoration:none;">${submitterEmail}</a>
                 </p>`
              : ""
          }
          <table style="border-collapse: collapse; width: 100%; margin-bottom: 28px; border-radius: 8px; overflow: hidden;">
            <tbody>
              ${formRows}
            </tbody>
          </table>

          <h2 style="margin:0 0 12px; font-size:18px; color:#0f172a;">Submitted Files</h2>

          <div style="margin-bottom: 20px;">
            <h3 style="margin:0 0 8px; font-size:16px; color:#1e293b;">Images</h3>
            <ul style="margin:0; padding-left:0;">
              ${imageList}
            </ul>
          </div>

          <div>
            <h3 style="margin:0 0 8px; font-size:16px; color:#1e293b;">Video Files</h3>
            <ul style="margin:0; padding-left: 0; color:#0f172a; font-size:14px;">
              ${videoList}
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;

  try {
    const response = await resend.emails.send({
      from: staticFrom,
      to: ownerEmail,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
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
