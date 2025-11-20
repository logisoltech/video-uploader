import { NextResponse } from "next/server";
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

export async function POST(req) {
  const { filename, contentType, size, email } = await req.json();

  const PART_SIZE = 10 * 1024 * 1024;
  const partCount = Math.ceil(size / PART_SIZE);
  if (partCount > 10000) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const sanitizedEmail =
    typeof email === "string" && email.trim() ? email.trim().replace(/[@.]/g, "_") : "";
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2);

  const keyParts = ["uploads"];
  if (sanitizedEmail) keyParts.push(sanitizedEmail);
  keyParts.push(`${timestamp}-${randomSuffix}-${filename}`);

  const key = keyParts.join("/");

  const created = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ContentType: contentType || "application/octet-stream",
    })
  );

  const urls = [];
  for (let i = 1; i <= partCount; i++) {
    const cmd = new UploadPartCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      PartNumber: i,
      UploadId: created.UploadId,
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 60 });
    urls.push(url);
  }

  return NextResponse.json({
    uploadId: created.UploadId,
    key,
    partSize: PART_SIZE,
    urls,
  });
}
