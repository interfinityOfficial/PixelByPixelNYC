const uploadButton = document.getElementById('upload-button');
const dropZone = document.getElementById('drop-zone');
const dropZoneTextUpload = document.getElementById('drop-zone-text-upload');
const fileInput = document.getElementById('file-upload-input');
const imageCropView = document.getElementById('image-crop-view');
const cropperImage = document.getElementById('cropper-image');
const cropCancelButton = document.getElementById('crop-cancel');
const cropConfirmButton = document.getElementById('crop-confirm');
const infoButton = document.getElementById('info-button');
const pixelCloseButton = document.getElementById('pixel-close-button');
const closeButton = document.getElementById('close-button');
const alertBox = document.getElementById('alert-box');
const alertText = document.getElementById('alert-text');
const alertDismissButton = document.getElementById('alert-dismiss');
const alertActionButton = document.getElementById('alert-action');
let alertAction = null;
let dragCounter = 0;
let currentFile = null;
let cropper = null;
let croppedFile = null;
let isSelectingPixel = false;
let selectedPixelData = null;

const resizeObserver = new ResizeObserver((entries) => {
    dropZone.style.setProperty('--drop-zone-text-height', `${entries[0].contentRect.height}px`);
});
resizeObserver.observe(dropZoneTextUpload);

infoButton.addEventListener('click', () => {
    document.body.classList = "show-info-view";
});

pixelCloseButton.addEventListener('click', () => {
    document.body.classList = "";
    fileInput.value = '';
    croppedFile = null;
    selectedPixelData = null;
    isSelectingPixel = false;
    if (window.exitPixelSelectionMode) {
        window.exitPixelSelectionMode();
    }
});

closeButton.addEventListener('click', () => {
    document.body.classList = "";
});

alertDismissButton.addEventListener('click', () => {
    document.body.classList = "";
});

alertActionButton.addEventListener('click', () => {
    document.body.classList = "";
    if (alertAction) {
        alertAction();
    }
});

function showAlert(text, dismissText = 'DISMISS', actionText = 'CONFIRM', action = null) {
    alertText.innerHTML = text;
    document.body.classList = "show-alert";
    alertDismissButton.textContent = dismissText;
    alertActionButton.textContent = actionText;
    if (action) {
        alertActionButton.style.display = 'flex';
        alertAction = action;
    } else {
        alertActionButton.style.display = 'none';
        alertAction = null;
    }
}

uploadButton.addEventListener('click', () => {
    if (isSelectingPixel) {
        isSelectingPixel = false;
        uploadPhoto();
    } else {
        fileInput.click();
    }
});

function isFileDrag(e) {
    return e.dataTransfer && [...e.dataTransfer.types].includes('Files');
}

window.addEventListener('dragenter', e => {
    if (!isFileDrag(e)) return;
    dragCounter++;
    document.body.classList.add('highlight')
});

window.addEventListener('dragleave', e => {
    if (!isFileDrag(e)) return;
    dragCounter--;
    if (dragCounter <= 0) {
        document.body.classList.remove('highlight')
    }
});

window.addEventListener('dragover', e => {
    if (isFileDrag(e)) e.preventDefault();
});

window.addEventListener('drop', e => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('highlight')
    const file = e.dataTransfer.files[0];
    handleFiles(file);
});

fileInput.addEventListener('change', e => {
    handleFiles(e.target.files[0]);
});

function handleFiles(file) {
    if (!file) {
        document.body.classList.remove('highlight')
        return;
    }

    document.body.classList.add('highlight')
    const allowedTypes = ['image/png', 'image/jpeg'];
    if (!allowedTypes.includes(file.type)) {
        showAlert('PNG OR JPG ONLY', "OK");
        document.body.classList.remove('highlight')
        return;
    }

    if (file.size > 50 * 1024 * 1024) {
        showAlert('FILE TOO LARGE<br />MAX SIZE IS 50MB', "OK");
        document.body.classList.remove('highlight')
        return;
    }

    document.body.classList.add('cropping')
    currentFile = file;
    const url = URL.createObjectURL(file);
    cropperImage.src = url;

    if (cropper) {
        cropper.destroy();
    }
    cropper = new Cropper(cropperImage, {
        background: false,
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 1,
        guides: false,
    });
}

cropCancelButton.addEventListener('click', () => {
    if (cropper) {
        setTimeout(() => {
            cropperImage.src = '';
            cropper.destroy();
            cropper = null;
        }, 300);
    }
    fileInput.value = '';
    document.body.classList.remove('highlight')
    document.body.classList.remove('cropping')
});

cropConfirmButton.addEventListener('click', () => {
    if (!cropper) {
        document.body.classList.remove('highlight')
        document.body.classList.remove('cropping')
        return;
    };

    cropper.getCroppedCanvas().toBlob((blob) => {
        croppedFile = new File([blob], currentFile.name, { type: currentFile.type });
        initiatePixelSelectionMode();
    });
});

function initiatePixelSelectionMode() {
    setTimeout(() => {
        if (cropper) {
            cropperImage.src = '';
            cropper.destroy();
            cropper = null;
        }
    }, 300);

    document.body.classList.remove('highlight')
    document.body.classList.remove('cropping')

    isSelectingPixel = true;
    document.body.classList.add('pixel-selection-mode');

    if (window.enterPixelSelectionMode) {
        window.enterPixelSelectionMode();
    }
}

function selectPixel(x, y) {
    selectedPixelData = { x, y };
}

function blobToArrayBuffer(blob) {
    return blob.arrayBuffer();
}

async function sha256Hex(buffer) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) reject(new Error('Failed to encode canvas'));
            else resolve(blob);
        }, 'image/jpeg', quality);
    });
}

async function makeLowResBlob(file, maxSize = 200) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvasToJpegBlob(canvas, 0.6);
}

async function extractVibrantColor(file) {
    if (typeof Vibrant === 'undefined' || !Vibrant.from) {
        throw new Error('Vibrant library not loaded');
    }
    const url = URL.createObjectURL(file);
    try {
        const palette = await Vibrant.from(url).getPalette();
        return palette.Vibrant?.hex || palette.Muted?.hex || '#808080';
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function uploadPhoto() {
    document.body.classList.remove('pixel-selection-mode');
    document.body.classList.remove('show-confirm');
    document.body.classList.add('uploading');
    if (window.exitPixelSelectionMode) {
        window.exitPixelSelectionMode();
    }

    const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1500,
        useWebWorker: true,
        fileType: 'image/jpeg',
    };

    try {
        const compressedFile = await imageCompression(croppedFile, options);
        const [lowResBlob, color, highResBuffer] = await Promise.all([
            makeLowResBlob(compressedFile, 200),
            extractVibrantColor(compressedFile),
            blobToArrayBuffer(compressedFile),
        ]);
        const key = await sha256Hex(highResBuffer);

        uploadFile(
            compressedFile,
            lowResBlob,
            color,
            key,
            selectedPixelData.x,
            selectedPixelData.y,
            (data) => {
                fileInput.value = '';
                if (data.success) {
                    if (data.data.duplicate) {
                        showAlert('THIS IMAGE ALREADY EXISTS<br />PLEASE UPLOAD A NEW IMAGE', "OK");
                    } else if (window.refreshPhotos) {
                        window.refreshPhotos();
                    }
                } else {
                    showAlert('UPLOAD FAILED<br />PLEASE TRY AGAIN', "OK");
                }
            }
        );
    } catch (error) {
        console.error(error);
        showAlert('PHOTO PROCESSING FAILED<br />PLEASE TRY AGAIN', "OK");
        document.body.classList.remove('uploading');
    }
}

function uploadFile(highResFile, lowResBlob, color, key, x, y, callback) {
    const formData = new FormData();
    formData.append('highRes', new File([highResFile], 'high-res.jpg', { type: 'image/jpeg' }));
    formData.append('lowRes', new File([lowResBlob], 'low-res.jpg', { type: 'image/jpeg' }));
    formData.append('color', color);
    formData.append('key', key);
    formData.append('imageX', x);
    formData.append('imageY', y);

    fetch('/upload/', {
        method: 'POST',
        body: formData,
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.success) {
                callback({ success: true, data: data });
            } else {
                callback({ success: false, error: data.error });
            }
        })
        .catch((error) => {
            callback({ success: false, error: error.message });
        });
}
