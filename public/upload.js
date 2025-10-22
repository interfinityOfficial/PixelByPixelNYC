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

// Handle dropped files
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

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
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
    // Hide cropper UI
    setTimeout(() => {
        if (cropper) {
            cropperImage.src = '';
            cropper.destroy();
            cropper = null;
        }
    }, 300);

    document.body.classList.remove('highlight')
    document.body.classList.remove('cropping')

    // Enter pixel selection mode
    isSelectingPixel = true;
    document.body.classList.add('pixel-selection-mode');

    // Tell map.js to enter pixel selection mode
    if (window.enterPixelSelectionMode) {
        window.enterPixelSelectionMode();
    }
}

function selectPixel(x, y) {
    // Call the upload.js function
    selectedPixelData = { x, y };
}

async function uploadPhoto() {
    document.body.classList.remove('pixel-selection-mode');
    document.body.classList.remove('show-confirm');
    document.body.classList.add('uploading');
    if (window.exitPixelSelectionMode) {
        window.exitPixelSelectionMode();
    }

    const options = {
        maxSizeMB: 1, // Maximum size 1MB
        maxWidthOrHeight: 1500,
        useWebWorker: true,
    };

    try {
        const compressedFile = await imageCompression(croppedFile, options);
        console.log('Original:', (croppedFile.size / 1024 / 1024).toFixed(2), 'MB');
        console.log('Compressed:', (compressedFile.size / 1024 / 1024).toFixed(2), 'MB');

        uploadFile(compressedFile, selectedPixelData.x, selectedPixelData.y, (data) => {
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
        });
    } catch (error) {
        showAlert('PHOTO COMPRESSION FAILED<br />PLEASE TRY AGAIN', "OK");
    }
}

function uploadFile(file, x, y, callback) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('imageX', x);
    formData.append('imageY', y);

    try {
        fetch('/upload/', {
            method: 'POST',
            body: formData,
        }).then(response => response.json()).then(data => {
            if (data.success) {
                callback({ success: true, data: data });
            } else {
                callback({ success: false, error: data.error });
            }
        }).catch(error => {
            callback({ success: false, error: error.message });
        });
    } catch (err) {
        callback({ success: false, error: err.message });
    }
}