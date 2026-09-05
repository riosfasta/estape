export const MAX_MARKETPLACE_IMAGE_BYTES = 500 * 1024;

export function cropRectangle(width, height, aspect, zoom, horizontal, vertical) {
  let cropWidth = Math.min(width, height * aspect) / zoom;
  let cropHeight = cropWidth / aspect;
  return { x: (width - cropWidth) * horizontal / 100, y: (height - cropHeight) * vertical / 100, width: cropWidth, height: cropHeight };
}

export function imageFileError(file) {
  if (!file || !/\.(jpe?g|png|webp)$/i.test(file.name) || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a JPG, JPEG, PNG or WebP image.";
  if (file.size > MAX_MARKETPLACE_IMAGE_BYTES) return "Each image must be 500 KB or smaller.";
  return "";
}

export function imagePreviewURL(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("Could not preview this image")); reader.readAsDataURL(file); });
}

export async function cropMarketplaceImage(file, purpose = "profile") {
  const error = imageFileError(file);
  if (error) throw new Error(error);
  const sourceURL = URL.createObjectURL(file);
  const picture = new Image();
  try { picture.src = sourceURL; await picture.decode(); }
  catch { URL.revokeObjectURL(sourceURL); throw new Error("This image could not be opened."); }
  if (picture.naturalWidth < 100 || picture.naturalHeight < 100 || picture.naturalWidth * picture.naturalHeight > 16000000) {
    URL.revokeObjectURL(sourceURL); throw new Error("Use an image at least 100 x 100 pixels and no larger than 16 megapixels.");
  }
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal market-crop-dialog";
    dialog.setAttribute("aria-labelledby", "marketCropTitle");
    dialog.innerHTML = `<h2 id="marketCropTitle">Crop & preview ${purpose === "identity" ? "ID card" : purpose === "profile" ? "profile photo" : "project photo"}</h2>
      <p>${purpose === "identity" ? "Keep the whole document, all corners and text readable. Your ID stays private." : "Adjust the crop and check the preview before using this image."}</p>
      <canvas aria-label="Cropped image preview"></canvas>
      <div class="market-crop-controls"><label>Shape<select data-crop-aspect><option value="original">Original proportions</option><option value="1">Square</option><option value="1.6">Landscape</option><option value="0.75">Portrait</option></select></label>
      <label>Zoom<input data-crop-zoom type="range" min="1" max="3" step="0.01" value="1"></label>
      <label>Move left / right<input data-crop-x type="range" min="0" max="100" value="50"></label>
      <label>Move up / down<input data-crop-y type="range" min="0" max="100" value="50"></label></div>
      <p data-crop-status role="status" aria-live="polite"></p><div class="toolbar"><button type="button" class="btn primary" data-crop-use>Use this image</button><button type="button" class="btn" data-crop-reset>Reset</button><button type="button" class="btn" data-crop-cancel>Cancel</button></div>`;
    const find = selector => dialog.querySelector(selector);
    const canvas = find("canvas");
    const aspectControl = find("[data-crop-aspect]");
    if (purpose === "profile") { aspectControl.innerHTML = '<option value="1">Square (profile photo)</option>'; canvas.style.borderRadius = "50%"; }
    aspectControl.value = purpose === "profile" ? "1" : "original";
    let working = false;
    function draw() {
      const aspect = aspectControl.value === "original" ? picture.naturalWidth / picture.naturalHeight : Number(aspectControl.value);
      const crop = cropRectangle(picture.naturalWidth, picture.naturalHeight, aspect, Number(find("[data-crop-zoom]").value), Number(find("[data-crop-x]").value), Number(find("[data-crop-y]").value));
      const scale = Math.min(1, (purpose === "profile" ? 800 : 1600) / Math.max(crop.width, crop.height));
      canvas.width = Math.round(crop.width * scale); canvas.height = Math.round(crop.height * scale);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(picture, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
    }
    function finish(result) { dialog.close(); dialog.remove(); URL.revokeObjectURL(sourceURL); resolve(result); }
    find("[data-crop-cancel]").onclick = () => { if (!working) finish(null); };
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (!working) finish(null); });
    find("[data-crop-reset]").onclick = () => { aspectControl.value = purpose === "profile" ? "1" : "original"; find("[data-crop-zoom]").value = "1"; find("[data-crop-x]").value = "50"; find("[data-crop-y]").value = "50"; draw(); };
    dialog.querySelectorAll("input,select").forEach(control => { control.oninput = draw; });
    find("[data-crop-use]").onclick = async () => {
      working = true;
      dialog.querySelectorAll("button,input,select").forEach(control => { control.disabled = true; });
      try {
        if (canvas.width < 100 || canvas.height < 100) throw new Error("Crop is too small. Reduce the zoom.");
        let blob;
        for (const quality of [0.92, 0.82, 0.72, 0.6, 0.45]) {
          blob = await new Promise(resolveBlob => canvas.toBlob(resolveBlob, "image/jpeg", quality));
          if (blob && blob.size <= MAX_MARKETPLACE_IMAGE_BYTES) break;
        }
        if (!blob || blob.size > MAX_MARKETPLACE_IMAGE_BYTES) throw new Error("The cropped image exceeds 500 KB. Choose a smaller image or crop more closely.");
        finish(new File([blob], `${purpose}.jpg`, { type: "image/jpeg" }));
      } catch (error) { find("[data-crop-status]").textContent = error.message; }
      finally { working = false; dialog.querySelectorAll("button,input,select").forEach(control => { control.disabled = false; }); }
    };
    document.body.append(dialog); dialog.showModal(); draw();
  });
}
