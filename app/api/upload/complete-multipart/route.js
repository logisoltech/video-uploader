import { NextResponse } from "next/server";
import { S3Client, CompleteMultipartUploadCommand } from "@aws-sdk/client-s3";

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
  const { key, uploadId, parts } = await req.json(); // [{ ETag, PartNumber }]

  const completed = await s3.send(
    new CompleteMultipartUploadCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    })
  );

  // If bucket Public Access is enabled, build a public URL
  const base = process.env.PUBLIC_FILE_BASE_URL;
  const fileUrl = base ? `${base.replace(/\/+$/, "")}/${key}` : completed.Location || key;

  return NextResponse.json({ ok: true, fileUrl, key });
}

