import { NextResponse } from "next/server";
import { Resend } from "resend";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "fs/promises";
import { join } from "path";

function buildResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function isValidEmail(value) {
  if (typeof value !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildRecipientEmails() {
  const emails = [];
  
  // Primary option: Check OWNER_EMAIL (supports comma-separated or single email)
  const ownerEmail = typeof process.env.OWNER_EMAIL === "string" ? process.env.OWNER_EMAIL.trim() : "";
  if (ownerEmail) {
    // Split by comma and filter valid emails
    const emailList = ownerEmail.split(",").map((e) => e.trim()).filter((e) => e && isValidEmail(e));
    emails.push(...emailList);
  }
  
  // Fallback option: Check for OWNER_EMAIL_1 and OWNER_EMAIL_2 if OWNER_EMAIL not set
  if (emails.length === 0) {
    const email1 = typeof process.env.OWNER_EMAIL_1 === "string" ? process.env.OWNER_EMAIL_1.trim() : "";
    const email2 = typeof process.env.OWNER_EMAIL_2 === "string" ? process.env.OWNER_EMAIL_2.trim() : "";
    
    if (email1 && isValidEmail(email1)) {
      emails.push(email1);
    }
    if (email2 && isValidEmail(email2)) {
      emails.push(email2);
    }
  }
  
  return emails;
}

const ticketClient =
  process.env.S3_BUCKET && process.env.S3_REGION && process.env.S3_ENDPOINT
    ? new S3Client({
        region: process.env.S3_REGION,
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
      })
    : null;

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable ?? []) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getNextTicketId() {
  if (!ticketClient) {
    throw new Error("S3 configuration missing for ticket counter.");
  }

  const bucket = process.env.S3_BUCKET;
  const counterKey = process.env.TICKET_COUNTER_KEY || "tickets/counter.txt";
  const startValue = Number.parseInt(process.env.TICKET_COUNTER_START || "1830", 10);
  const initialCounter = Number.isFinite(startValue) ? startValue - 1 : 1829;

  let current = initialCounter;
  let etag;

  try {
    const existing = await ticketClient.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: counterKey,
      })
    );

    etag = existing.ETag;

    if (existing.Body) {
      const body = await streamToString(existing.Body);
      const parsed = Number.parseInt(body.trim(), 10);
      if (Number.isFinite(parsed)) {
        current = parsed;
      }
    }
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const code = error?.name || error?.Code;
    if (status !== 404 && code !== "NoSuchKey" && code !== "NotFound") {
      throw error;
    }
  }

  const nextTicket = current + 1;

  try {
    await ticketClient.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: counterKey,
        Body: String(nextTicket),
        ContentType: "text/plain",
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      })
    );
  } catch (error) {
    if ((error?.name || error?.Code) === "PreconditionFailed") {
      return getNextTicketId();
    }
    throw error;
  }

  return nextTicket;
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
  const recipientEmails = buildRecipientEmails();

  if (!staticFrom) {
    return NextResponse.json(
      { ok: false, error: "FROM_EMAIL must be a valid email or formatted as 'Name <email@example.com>'." },
      { status: 400 }
    );
  }

  if (recipientEmails.length === 0) {
    return NextResponse.json(
      { ok: false, error: "At least one recipient email must be configured. Use OWNER_EMAIL_1 and OWNER_EMAIL_2, or OWNER_EMAIL." },
      { status: 400 }
    );
  }

  let ticketId;
  try {
    ticketId = await getNextTicketId();
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unable to allocate ticket ID.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
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

  const { form = {}, videoUrls = [], imageUrls = [], templateType, selectedTemplate } = payload || {};
  const submitterEmail = typeof form.email === "string" ? form.email.trim() : "";
  const replyTo = isValidEmail(submitterEmail) ? submitterEmail : undefined;
  const subject = `New video submission${submitterEmail ? ` from ${submitterEmail}` : ""} · #${ticketId}`;

  // Upload selected template image to R2 if template is selected
  let templateImageUrl = null;
  if ((templateType === "static" || templateType === "animated") && selectedTemplate && typeof selectedTemplate === "number") {
    try {
      let templateImagePath;
      let contentType;
      let fileName;
      
      const sanitizedEmail = submitterEmail ? submitterEmail.trim().replace(/[@.]/g, "_") : "";
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).slice(2);
      
      if (templateType === "static") {
        templateImagePath = join(process.cwd(), "public", `template${selectedTemplate}.webp`);
        contentType = "image/webp";
        fileName = `template-${timestamp}-${randomSuffix}-template${selectedTemplate}.webp`;
      } else {
        templateImagePath = join(process.cwd(), "public", `animated-template-${selectedTemplate}.png`);
        contentType = "image/png";
        fileName = `template-${timestamp}-${randomSuffix}-animated-template-${selectedTemplate}.png`;
      }
      
      const templateImageBuffer = await readFile(templateImagePath);
      
      const keyParts = ["uploads"];
      if (sanitizedEmail) keyParts.push(sanitizedEmail);
      keyParts.push(fileName);
      const templateKey = keyParts.join("/");

      if (ticketClient) {
        await ticketClient.send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: templateKey,
            Body: templateImageBuffer,
            ContentType: contentType,
          })
        );

        const base = process.env.PUBLIC_FILE_BASE_URL;
        templateImageUrl = base ? `${base.replace(/\/+$/, "")}/${templateKey}` : templateKey;
      }
    } catch (error) {
      console.error("Failed to upload template image:", error);
    }
  }

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
    .filter(([key]) => !["uploadedImageKeys", "uploadedVideoKeys"].includes(key))
    .map(
      ([key, value]) => {
        // Handle videoLinks specially if it's an array
        if (key === "videoLinks" && Array.isArray(value)) {
          const videoLinksList = value.length > 0
            ? value
                .map(
                  (link, index) => `
                    <div style="margin-bottom: 8px;">
                      <div style="font-weight: 600; color:#1e293b; margin-bottom: 4px;">Video Link ${index + 1}</div>
                      <a href="${link}" style="display:inline-block; color: #0c68ff; text-decoration: none; word-break: break-all;">${link}</a>
                    </div>
                  `
                )
                .join("")
            : `<div style="color: #94a3b8;">No video links provided</div>`;
          
          return `
            <tr>
              <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; background:#f8fafc; font-weight: 600; width: 35%;">
                ${formatLabel(key)}
              </td>
              <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0;">
                ${videoLinksList}
              </td>
            </tr>
          `;
        }
        
        return `
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
        `;
      }
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
          ${
            templateType || selectedTemplate
              ? `
          <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid #e2e8f0;">
            <h3 style="margin:0 0 8px; font-size:16px; color:#1e293b;">Template Selection</h3>
            <table style="border-collapse: collapse; width: 100%;">
              <tbody>
                <tr>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; background:#f8fafc; font-weight: 600; width: 35%;">
                    Template Type
                  </td>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0;">
                    <span style="font-weight: 500; color:#1e293b;">${templateType === "static" ? "Static" : templateType === "animated" ? "Animated" : "N/A"}</span>
                  </td>
                </tr>
                ${
                  templateImageUrl && (templateType === "static" || templateType === "animated")
                    ? `
                <tr>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0; background:#f8fafc; font-weight: 600; width: 35%;">
                    Template Requested
                  </td>
                  <td style="padding: 8px 12px; border-bottom: 1px solid #f0f0f0;">
                    <div style="margin-top: 8px;">
                      <a href="${templateImageUrl}" style="display:inline-block; border-radius:10px; overflow:hidden; border:1px solid #e2e8f0;">
                        <img src="${templateImageUrl}" alt="${templateType === "static" ? "Selected template" : "Animated template"} ${selectedTemplate}" style="display:block; width:400px; height:auto; max-width:100%;" />
                      </a>
                      <div style="font-size: 12px; color: #64748b; margin-top: 6px;">${templateType === "static" ? "Template" : "Animated Template"} ${selectedTemplate}</div>
                    </div>
                  </td>
                </tr>
                `
                    : ""
                }
              </tbody>
            </table>
          </div>
          `
              : ""
          }
        </div>
      </div>
    </div>
  `;

  try {
    const response = await resend.emails.send({
      from: staticFrom,
      to: recipientEmails.length === 1 ? recipientEmails[0] : recipientEmails,
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
          ticketId,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, id: response.data?.id, ticketId });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to send email with Resend.",
        details: error instanceof Error ? error.message : String(error),
        ticketId,
      },
      { status: 500 }
    );
  }
}
