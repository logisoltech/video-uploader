import { NextResponse } from "next/server";
import { S3Client, AbortMultipartUploadCommand } from "@aws-sdk/client-s3";

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
  const { key, uploadId } = await req.json();

  if (!key || !uploadId) {
    return NextResponse.json(
      { ok: false, error: "Both key and uploadId are required to abort a multipart upload." },
      { status: 400 }
    );
  }

  try {
    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        UploadId: uploadId,
      })
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to abort multipart upload.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}


