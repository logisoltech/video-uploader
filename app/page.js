"use client";

import { useMemo, useRef, useState } from "react";

const initialForm = {
  phoneNumber: "",
  playerFirstName: "",
  playerLastName: "",
  graduationYear: "",
  clubTeamName: "",
  clubTeamColors: "",
  clubTeamNumber: "",
  clubTeamPositions: "",
  schoolTeamName: "",
  schoolTeamColors: "",
  schoolTeamNumber: "",
  schoolTeamPositions: "",
  honors: "",
  videoCutInstructions: "",
  videoLinks: "",
};

async function uploadFileToR2(file, onProgress) {
  const createRes = await fetch("/api/upload/create-multipart", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
    }),
  });

  if (!createRes.ok) {
    const error = await createRes.json().catch(() => ({}));
    throw new Error(error?.error || "Failed to start upload");
  }

  const { uploadId, key, partSize, urls } = await createRes.json();
  const parts = [];
  const totalParts = urls.length || 1;

  for (let index = 0; index < totalParts; index += 1) {
    const start = index * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);

    const uploadRes = await fetch(urls[index], {
      method: "PUT",
      body: blob,
    });

    if (!uploadRes.ok) {
      throw new Error(`Failed to upload part ${index + 1}`);
    }

    let etag = uploadRes.headers.get("ETag") || "";
    etag = etag.replace(/"/g, "");

    parts.push({ ETag: etag, PartNumber: index + 1 });

    if (onProgress) {
      onProgress(((index + 1) / totalParts) * 100);
    }
  }

  const completeRes = await fetch("/api/upload/complete-multipart", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, uploadId, parts }),
  });

  if (!completeRes.ok) {
    const error = await completeRes.json().catch(() => ({}));
    throw new Error(error?.error || "Failed to finalize upload");
  }

  const { fileUrl } = await completeRes.json();
  return { fileUrl, key };
}

export default function Home() {
  const [form, setForm] = useState(initialForm);
  const [imageFiles, setImageFiles] = useState([]);
  const [videoFiles, setVideoFiles] = useState([]);
  const [imageProgress, setImageProgress] = useState({});
  const [videoProgress, setVideoProgress] = useState({});
  const [imageInputKey, setImageInputKey] = useState(0);
  const [videoInputKey, setVideoInputKey] = useState(0);
  const [status, setStatus] = useState({ type: "idle", message: "" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const hasImageSelection = imageFiles.length > 0;
  const hasVideoSelection = videoFiles.length > 0;

  const makeFileKey = (file) => `${file.name}-${file.size}-${file.lastModified ?? ""}`;

  const handleChange = (field) => (event) => {
    setForm((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const handleImageChange = (event) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length) {
      return;
    }

    setImageFiles((prev) => {
      const merged = new Map(prev.map((file) => [makeFileKey(file), file]));
      files.forEach((file) => {
        merged.set(makeFileKey(file), file);
      });
      return Array.from(merged.values());
    });

    setImageProgress((prev) => {
      const next = { ...prev };
      files.forEach((file) => {
        const key = makeFileKey(file);
        if (!(key in next)) next[key] = 0;
      });
      return next;
    });

    if (event.target) {
      event.target.value = "";
    }
  };

  const handleRemoveImage = (fileKey) => {
    setImageFiles((prev) => prev.filter((file) => makeFileKey(file) !== fileKey));
    setImageProgress((prev) => {
      const { [fileKey]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const handleVideoChange = (event) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (!files.length) {
      return;
    }

    setVideoFiles((prev) => {
      const merged = new Map(prev.map((file) => [makeFileKey(file), file]));
      files.forEach((file) => {
        merged.set(makeFileKey(file), file);
      });
      return Array.from(merged.values());
    });

    setVideoProgress((prev) => {
      const next = { ...prev };
      files.forEach((file) => {
        const key = makeFileKey(file);
        if (!(key in next)) next[key] = 0;
      });
      return next;
    });

    if (event.target) {
      event.target.value = "";
    }
  };

  const handleRemoveVideo = (fileKey) => {
    setVideoFiles((prev) => prev.filter((file) => makeFileKey(file) !== fileKey));
    setVideoProgress((prev) => {
      const { [fileKey]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const resetForm = () => {
    setForm(initialForm);
    setImageFiles([]);
    setVideoFiles([]);
    setImageProgress({});
    setVideoProgress({});
    setImageInputKey((prev) => prev + 1);
    setVideoInputKey((prev) => prev + 1);
  };

  const validateBeforeSubmit = () => {
    if (!form.playerFirstName.trim() || !form.playerLastName.trim()) {
      setStatus({ type: "error", message: "Player name is required." });
      return false;
    }

    if (!form.videoCutInstructions.trim()) {
      setStatus({ type: "error", message: "Cut instructions are required." });
      return false;
    }

    if (!imageFiles.length) {
      setStatus({ type: "error", message: "Please upload at least one image." });
      return false;
    }

    if (!videoFiles.length) {
      setStatus({ type: "error", message: "Please upload at least one video." });
      return false;
    }

    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    setStatus({ type: "idle", message: "" });

    if (!validateBeforeSubmit()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const imageUploads = [];
      for (let index = 0; index < imageFiles.length; index += 1) {
        const file = imageFiles[index];
        const fileKey = makeFileKey(file);

        const result = await uploadFileToR2(file, (progress) => {
          setImageProgress((prev) => ({
            ...prev,
            [fileKey]: progress,
          }));
        });

        imageUploads.push({ ...result, name: file.name, label: fileKey });
      }

      const videoUploads = [];
      for (let index = 0; index < videoFiles.length; index += 1) {
        const file = videoFiles[index];
        const fileKey = makeFileKey(file);

        const result = await uploadFileToR2(file, (progress) => {
          setVideoProgress((prev) => ({
            ...prev,
            [fileKey]: progress,
          }));
        });

        videoUploads.push({ ...result, name: file.name, label: fileKey });
      }

      const response = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form: {
            phoneNumber: form.phoneNumber,
            playerFirstName: form.playerFirstName,
            playerLastName: form.playerLastName,
            graduationYear: form.graduationYear,
            clubTeamName: form.clubTeamName,
            clubTeamColors: form.clubTeamColors,
            clubTeamNumber: form.clubTeamNumber,
            clubTeamPositions: form.clubTeamPositions,
            schoolTeamName: form.schoolTeamName,
            schoolTeamColors: form.schoolTeamColors,
            schoolTeamNumber: form.schoolTeamNumber,
            schoolTeamPositions: form.schoolTeamPositions,
            honors: form.honors,
            videoCutInstructions: form.videoCutInstructions,
            videoLinks: form.videoLinks,
            uploadedImageKeys: imageUploads.map((image) => image.key),
            uploadedVideoKeys: videoUploads.map((video) => video.key),
          },
          videoUrls: videoUploads.map((video) => video.fileUrl),
          imageUrls: imageUploads.map((image) => image.fileUrl),
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || "Failed to submit form");
      }

      setStatus({ type: "success", message: "Submission sent successfully!" });
      resetForm();
    } catch (error) {
      setStatus({
        type: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const imageFileList = useMemo(
    () =>
      imageFiles.map((file) => ({
        name: file.name,
        size: file.size,
        key: makeFileKey(file),
      })),
    [imageFiles]
  );

  const videoFileList = useMemo(
    () =>
      videoFiles.map((file, index) => ({
        name: file.name,
        size: file.size,
        key: makeFileKey(file),
      })),
    [videoFiles]
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="flex flex-col gap-4 bg-white px-8 py-6 shadow md:flex-row md:items-center md:justify-between md:px-16">
        <div className="text-lg font-semibold uppercase tracking-[0.06em] text-slate-900">
          
        </div>
        <nav>
          <ul className="flex items-center gap-6 text-base font-medium text-[#0070b8]">
            <li>
              <a className="transition hover:text-[#004f7c]" href="#">
                Home
              </a>
            </li>
            <li>
              <a className="transition hover:text-[#004f7c]" href="#">
                Contact
              </a>
            </li>
            <li>
              <a
                className="rounded bg-[#007dc5] px-6 py-2 font-semibold text-white transition hover:bg-[#006bad]"
                href="#"
              >
                Package Pricing
              </a>
            </li>
          </ul>
        </nav>
      </header>

      <main className="flex items-center justify-center bg-linear-to-b from-[#2a1c70] to-[#180f4f] px-5 py-16 md:py-24">
        <section className="w-full max-w-4xl rounded-md bg-white px-8 py-12 shadow-2xl md:px-16">
          <h1 className="mb-8 text-3xl font-semibold uppercase tracking-[0.08em] text-slate-900 md:text-4xl">
            Upload Video
          </h1>
          <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
            <label className="flex flex-col text-base font-semibold text-slate-600">
              Your Phone Number
              <input
                type="tel"
                placeholder="Enter your phone number"
                value={form.phoneNumber}
                onChange={handleChange("phoneNumber")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1">
                Player’s First Name
                <span className="text-[#d93025]">*</span>
              </span>
              <input
                type="text"
                placeholder="Enter first name"
                required
                value={form.playerFirstName}
                onChange={handleChange("playerFirstName")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1">
                Player’s Last Name
                <span className="text-[#d93025]">*</span>
              </span>
              <input
                type="text"
                placeholder="Enter last name"
                required
                value={form.playerLastName}
                onChange={handleChange("playerLastName")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Graduation Year
              <input
                type="number"
                placeholder="Enter graduation year"
                value={form.graduationYear}
                onChange={handleChange("graduationYear")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s Club Team Name
              <input
                type="text"
                placeholder="Enter club team name"
                value={form.clubTeamName}
                onChange={handleChange("clubTeamName")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s Club Team Colors
              <input
                type="text"
                placeholder="Enter club team colors"
                value={form.clubTeamColors}
                onChange={handleChange("clubTeamColors")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s Club Team Number
              <input
                type="text"
                placeholder="Enter club team number"
                value={form.clubTeamNumber}
                onChange={handleChange("clubTeamNumber")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s Club Team Position(s)
              <input
                type="text"
                placeholder="Enter club team position(s)"
                value={form.clubTeamPositions}
                onChange={handleChange("clubTeamPositions")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s School Team Name
              <input
                type="text"
                placeholder="Enter school team name"
                value={form.schoolTeamName}
                onChange={handleChange("schoolTeamName")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s School Team Colors
              <input
                type="text"
                placeholder="Enter school team colors"
                value={form.schoolTeamColors}
                onChange={handleChange("schoolTeamColors")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s School Team Number
              <input
                type="text"
                placeholder="Enter school team number"
                value={form.schoolTeamNumber}
                onChange={handleChange("schoolTeamNumber")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Player’s School Team Position(s)
              <input
                type="text"
                placeholder="Enter school team position(s)"
                value={form.schoolTeamPositions}
                onChange={handleChange("schoolTeamPositions")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              List of Academic and Athletic Honors
              <textarea
                placeholder="List honors separated by commas or sentences"
                rows={4}
                value={form.honors}
                onChange={handleChange("honors")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1">
                Upload Images
                <span className="text-[#d93025]">*</span>
              </span>
              <input
                key={imageInputKey}
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageChange}
                ref={imageInputRef}
                className="mt-3 block w-full cursor-pointer rounded border border-slate-300 bg-slate-50 px-4 py-3 text-base font-normal text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-[#007dc5] file:px-5 file:py-2.5 file:font-semibold file:text-white hover:file:bg-[#006bad] focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
              {hasImageSelection && (
                <ul className="mt-2 space-y-2 text-sm text-slate-500">
                  {imageFileList.map((file) => (
                    <li key={file.key}>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-1 items-center justify-between gap-4">
                          <span className="truncate">{file.name}</span>
                          <span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(file.key)}
                          className="inline-flex w-max items-center justify-center rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-500 transition hover:border-[#d93025] hover:text-[#d93025]"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-2 h-2 rounded bg-slate-200">
                        <div
                          className="h-full rounded bg-[#007dc5] transition-all"
                          style={{ width: `${Math.min(imageProgress[file.key] || 0, 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {hasImageSelection && (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="mt-3 inline-flex w-max items-center justify-center rounded border border-dashed border-[#007dc5] px-4 py-2 text-sm font-medium text-[#007dc5] transition hover:bg-[#f0f4ff]"
                >
                  Add more images
                </button>
              )}
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1">
                Upload your videos
                <span className="text-[#d93025]">*</span>
              </span>
              <input
                key={videoInputKey}
                type="file"
                multiple
                accept="video/*"
                onChange={handleVideoChange}
                ref={videoInputRef}
                className="mt-3 block w-full cursor-pointer rounded border border-slate-300 bg-slate-50 px-4 py-3 text-base font-normal text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-[#007dc5] file:px-5 file:py-2.5 file:font-semibold file:text-white hover:file:bg-[#006bad] focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
              {hasVideoSelection && (
                <ul className="mt-2 space-y-2 text-sm text-slate-500">
                  {videoFileList.map((file) => (
                    <li key={file.key}>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-1 items-center justify-between gap-4">
                          <span className="truncate">{file.name}</span>
                          <span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveVideo(file.key)}
                          className="inline-flex w-max items-center justify-center rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-500 transition hover:border-[#d93025] hover:text-[#d93025]"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="mt-2 h-2 rounded bg-slate-200">
                        <div
                          className="h-full rounded bg-[#007dc5] transition-all"
                          style={{ width: `${Math.min(videoProgress[file.key] || 0, 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {hasVideoSelection && (
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="mt-3 inline-flex w-max items-center justify-center rounded border border-dashed border-[#007dc5] px-4 py-2 text-sm font-medium text-[#007dc5] transition hover:bg-[#f0f4ff]"
                >
                  Add more videos
                </button>
              )}
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              <span className="inline-flex items-center gap-1">
                Tell us where to cut your videos
                <span className="text-[#d93025]">*</span>
              </span>
              <textarea
                placeholder="Example: Cut between 00:10 and 01:25"
                rows={3}
                required
                value={form.videoCutInstructions}
                onChange={handleChange("videoCutInstructions")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <label className="flex flex-col text-base font-semibold text-slate-600">
              Attach links of your videos
              <input
                type="url"
                placeholder="Example: https://drive.google.com/file/d/..., https://www.dropbox.com/scl/fi/..."
                value={form.videoLinks}
                onChange={handleChange("videoLinks")}
                className="mt-3 rounded border border-slate-300 px-4 py-4 text-base font-normal text-slate-700 placeholder:text-slate-400 focus:border-[#007dc5] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/20"
              />
            </label>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {status.type !== "idle" && (
                <p
                  className={`text-sm ${
                    status.type === "error" ? "text-[#d93025]" : "text-emerald-600"
                  }`}
                >
                  {status.message}
                </p>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-2 inline-flex w-max items-center justify-center rounded bg-[#007dc5] px-10 py-3 text-base font-semibold text-white transition hover:bg-[#006bad] focus:outline-none focus:ring-2 focus:ring-[#007dc5]/40 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
