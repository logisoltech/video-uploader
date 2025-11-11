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
  const { filename, contentType, size } = await req.json();

  const PART_SIZE = 10 * 1024 * 1024;
  const partCount = Math.ceil(size / PART_SIZE);
  if (partCount > 10000) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`;

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
