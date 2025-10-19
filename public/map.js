const MAP_COLS = 45;
const MAP_ROWS = 54;
const PIXEL_SIZE = 10;
let MAX_SCALE = 20; // Will be updated in resizeCanvas
const ZOOM_FACTOR = 1.03;

let mapData = [];
let photos = [];
const imageCache = new Map();
let scale = 1;
let minScale = 1;
let offsetX = 0;
let offsetY = 0;
let cursorX = 0;
let cursorY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;

let cursorInsideCanvas = false;

document.body.addEventListener('mouseenter', () => {
    cursorInsideCanvas = true;
});
document.body.addEventListener('mouseleave', () => {
    cursorInsideCanvas = false;
    drawMap(mapData);
});

let initialPinchDistance = 0;
let initialPinchCenter = { x: 0, y: 0 };
let initialScale = 1;

// Double-tap
let lastTouchTime = 0;
let lastTouchX = 0;
let lastTouchY = 0;
const DOUBLE_TAP_DELAY = 300;
const DOUBLE_TAP_DISTANCE = 50;

// Track if we were previously in multi-touch to prevent photo taps after pinch
let wasMultiTouch = false;

// Track potential photo tap that should trigger on touch end
let pendingPhotoTap = null;

// Pixel selection mode
let isPixelSelectionMode = false;
let hoveredPixel = null;
let selectedPixel = null;

// Drag detection for pixel selection
let dragOccurred = false;
let touchDragOccurred = false;
const DRAG_THRESHOLD = 5; // Minimum pixels to move before considering it a drag

function clampHexToHSL(hex, satRange = [40, 70], lightRange = [50, 80]) {
    hex = hex.replace(/^#/, '');
    const num = parseInt(hex, 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h *= 60;
    }
    s = Math.min(Math.max(s * 100, satRange[0]), satRange[1]);
    l = Math.min(Math.max(l * 100, lightRange[0]), lightRange[1]);
    console.log(hex);
    console.log(h, s, l);
    return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}


// Animate offset changes without changing scale
function animateToOffsets(targetOffsetX, targetOffsetY, duration = 300) {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    const startTime = performance.now();
    const startOffsetX = offsetX;
    const startOffsetY = offsetY;

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const easedProgress = 1 - Math.pow(1 - progress, 3); // Ease out cubic

        offsetX = startOffsetX + (targetOffsetX - startOffsetX) * easedProgress;
        offsetY = startOffsetY + (targetOffsetY - startOffsetY) * easedProgress;

        clampOffsets(offsetX, offsetY);
        drawMap(mapData);

        if (progress < 1) {
            animationId = requestAnimationFrame(animate);
        } else {
            animationId = null;
        }
    }

    animationId = requestAnimationFrame(animate);
}

// Helper function to show photo view after image loads
function showPhotoView(photo) {
    const imgElement = document.getElementById('photo-image');
    const img = new Image();

    img.onload = () => {
        // Image loaded successfully, show the view
        imgElement.src = photo.imageHighRes;
        document.body.classList.add('show-photo-view');
    };

    img.onerror = () => {
        // Image failed to load, could show error state or fallback
        console.warn('Failed to load high-res image:', photo.imageHighRes);
    };

    // Start loading the image
    img.src = photo.imageHighRes;
}

// Pixel selection mode functions
function enterPixelSelectionMode() {
    isPixelSelectionMode = true;
    hoveredPixel = null;
    selectedPixel = null;
    drawMap(mapData); // Redraw without photos
}

function exitPixelSelectionMode() {
    isPixelSelectionMode = false;
    hoveredPixel = null;
    selectedPixel = null;
    drawMap(mapData); // Redraw with photos
}

function handlePixelSelection(x, y) {
    // Call the upload.js function
    if (window.selectPixel) {
        window.selectPixel(x, y);
    }
}

// Refresh photos from server
function refreshPhotos() {
    fetch("/all-photos/")
        .then(res => res.json())
        .then(data => {
            document.body.classList.remove('uploading');
            document.body.classList.add('uploaded');
            setTimeout(() => {
                document.body.classList.remove('uploaded');
            }, 300);
            photos = data.photos;
            drawMap(mapData);
        })
        .catch(error => {
            console.error('Failed to refresh photos:', error);
        });
}

// Make functions available globally for upload.js
window.enterPixelSelectionMode = enterPixelSelectionMode;
window.exitPixelSelectionMode = exitPixelSelectionMode;
window.handlePixelSelection = handlePixelSelection;
window.refreshPhotos = refreshPhotos;

// Zoom animation
let animationId = null;
const ZOOM_ANIMATION_DURATION = 300;

const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');

// Disable image smoothing
ctx.imageSmoothingEnabled = false;
ctx.mozImageSmoothingEnabled = false;
ctx.webkitImageSmoothingEnabled = false;
ctx.msImageSmoothingEnabled = false;

const colorMap = {
    w: "#9EC9EB", // water
    m: "#F7E5CD", // Manhattan
    x: "#F7E5CD", // Bronx
    b: "#F7E5CD", // Brooklyn + Queens
};

function getCanvasRect() {
    return canvas.getBoundingClientRect();
}

function getCanvasCSSDimensions() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    return {
        width: canvas.width / devicePixelRatio,
        height: canvas.height / devicePixelRatio
    };
}

function updateCursorPosition(clientX, clientY) {
    const rect = getCanvasRect();
    cursorX = clientX - rect.left;
    cursorY = clientY - rect.top;
}

function clampOffsets(newOffsetX, newOffsetY) {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / devicePixelRatio;
    const cssHeight = canvas.height / devicePixelRatio;

    offsetX = Math.max(Math.min(newOffsetX, 0), cssWidth - MAP_COLS * PIXEL_SIZE * scale);
    offsetY = Math.max(Math.min(newOffsetY, 0), cssHeight - MAP_ROWS * PIXEL_SIZE * scale);
}

function performZoom(centerX, centerY, newScale, oldScale, animate = false, duration = ZOOM_ANIMATION_DURATION) {
    const targetScale = Math.max(minScale, Math.min(MAX_SCALE, newScale));

    if (animate) {
        animateZoom(centerX, centerY, targetScale, oldScale, duration);
    } else {
        scale = targetScale;
        const centerWorldX = (centerX - offsetX) / oldScale;
        const centerWorldY = (centerY - offsetY) / oldScale;
        clampOffsets(centerX - centerWorldX * scale, centerY - centerWorldY * scale);
        drawMap(mapData);
    }
}

function animateZoom(centerX, centerY, targetScale, startScale, duration = ZOOM_ANIMATION_DURATION) {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }

    const startTime = performance.now();
    const startOffsetX = offsetX;
    const startOffsetY = offsetY;

    const centerWorldX = (centerX - startOffsetX) / startScale;
    const centerWorldY = (centerY - startOffsetY) / startScale;

    function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        const easedProgress = 1 - Math.pow(1 - progress, 3);

        scale = startScale + (targetScale - startScale) * easedProgress;

        clampOffsets(centerX - centerWorldX * scale, centerY - centerWorldY * scale);

        drawMap(mapData);

        if (progress < 1) {
            animationId = requestAnimationFrame(animate);
        } else {
            animationId = null;
        }
    }

    animationId = requestAnimationFrame(animate);
}

// Load map data
fetch("/assets/map_data.json")
    .then((res) => res.json())
    .then((data) => {
        mapData = data;
        // Initial draw after data is loaded

        const cssDims = getCanvasCSSDimensions();
        offsetY = (cssDims.height - MAP_ROWS * PIXEL_SIZE * scale) / 2;
        drawMap(mapData);

        photos = window.__PHOTOS__;
        drawMap(mapData);
    });

canvas.addEventListener('mousemove', e => {
    updateCursorPosition(e.clientX, e.clientY);

    if (isPixelSelectionMode) {
        // In pixel selection mode, highlight the pixel under cursor
        const mapX = Math.floor((cursorX - offsetX) / (PIXEL_SIZE * scale));
        const mapY = Math.floor((cursorY - offsetY) / (PIXEL_SIZE * scale));

        // Ensure coordinates are within bounds
        if (mapX >= 0 && mapX < MAP_COLS && mapY >= 0 && mapY < MAP_ROWS) {
            hoveredPixel = { x: mapX, y: mapY };
        } else {
            hoveredPixel = null;
        }

        document.body.classList.add('pointer-cursor');
        drawMap(mapData); // Redraw to show hover effect
    } else {
        // Normal photo hover detection
        const mapX = Math.floor((cursorX - offsetX) / (PIXEL_SIZE * scale));
        const mapY = Math.floor((cursorY - offsetY) / (PIXEL_SIZE * scale));

        // Check for photos within a 2-pixel radius for better targeting
        let photo = null;
        const touchTolerance = 0;
        for (let dx = -touchTolerance; dx <= touchTolerance && !photo; dx++) {
            for (let dy = -touchTolerance; dy <= touchTolerance && !photo; dy++) {
                const checkX = mapX + dx;
                const checkY = mapY + dy;
                photo = photos.find(p => p.imageX === checkX && p.imageY === checkY);
            }
        }

        // Change cursor style based on whether we're over a photo
        canvas.classList.toggle('zoom-cursor', !!photo);
    }
});

// Mobile touch support
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    document.body.classList.remove('show-photo-view'); // Hide photo view on interaction
    const rect = getCanvasRect();
    const touch = e.touches[0];
    const currentTime = Date.now();
    const touchX = touch.clientX;
    const touchY = touch.clientY;

    // Set multi-touch flag and clear pending photo tap
    if (e.touches.length > 1) {
        wasMultiTouch = true;
        pendingPhotoTap = null;
    }

    // Only check for double-tap when there's exactly 1 touch (avoid conflicts with pinch)
    if (e.touches.length === 1 && !wasMultiTouch) {
        // First check if touch is on or near a photo (higher priority than double-tap)
        updateCursorPosition(touchX, touchY);
        const mapX = Math.floor((cursorX - offsetX) / (PIXEL_SIZE * scale));
        const mapY = Math.floor((cursorY - offsetY) / (PIXEL_SIZE * scale));

        // Check for photos within a 2-pixel radius for better touch targeting
        let photo = null;
        const touchTolerance = 0;
        for (let dx = -touchTolerance; dx <= touchTolerance && !photo; dx++) {
            for (let dy = -touchTolerance; dy <= touchTolerance && !photo; dy++) {
                const checkX = mapX + dx;
                const checkY = mapY + dy;
                photo = photos.find(p => p.imageX === checkX && p.imageY === checkY);
            }
        }

        if (photo) {
            // Store potential photo tap to trigger on touch end
            pendingPhotoTap = photo;
        }

        // Not on a photo - check for double-tap
        const timeDiff = currentTime - lastTouchTime;
        const distance = Math.sqrt(
            Math.pow(touchX - lastTouchX, 2) +
            Math.pow(touchY - lastTouchY, 2)
        );

        if (timeDiff < DOUBLE_TAP_DELAY && distance < DOUBLE_TAP_DISTANCE) {
            // Double-tap detected - zoom in
            updateCursorPosition(touchX, touchY);
            const oldScale = scale;
            const newScale = Math.min(MAX_SCALE, scale * 2); // Zoom in by 2x

            performZoom(cursorX, cursorY, newScale, oldScale, true); // Enable animation

            // Reset double-tap detection
            lastTouchTime = 0;
            return;
        }

        // Store this touch for potential double-tap detection
        lastTouchTime = currentTime;
        lastTouchX = touchX;
        lastTouchY = touchY;

        // Single touch - start dragging
        isDragging = true;
        touchDragOccurred = false; // Reset touch drag detection
        dragStartX = touch.clientX - offsetX;
        dragStartY = touch.clientY - offsetY;
    } else if (e.touches.length === 2) {
        // Two touches - start pinch zoom (skip double-tap detection)
        isDragging = false; // Cancel dragging during pinch
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        initialPinchDistance = getTouchDistance(touch1, touch2);
        initialPinchCenter = getTouchCenter(touch1, touch2, rect);
        initialScale = scale;
    }

    updateCursorPosition(touch.clientX, touch.clientY);
});

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();

    // Clear pending photo tap if gesture becomes multi-touch or drag
    if (e.touches.length > 1 || isDragging) {
        pendingPhotoTap = null;
    }

    if (e.touches.length === 1 && isDragging) {
        // Check if touch has moved beyond drag threshold
        const touch = e.touches[0];
        const deltaX = touch.clientX - (offsetX + dragStartX);
        const deltaY = touch.clientY - (offsetY + dragStartY);
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance > DRAG_THRESHOLD) {
            touchDragOccurred = true; // Mark that touch dragging occurred
        }

        clampOffsets(touch.clientX - dragStartX, touch.clientY - dragStartY);
        drawMap(mapData);
    } else if (e.touches.length === 2) {
        // Two touches - zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const currentDistance = getTouchDistance(touch1, touch2);
        const currentCenter = getTouchCenter(touch1, touch2, rect);

        if (initialPinchDistance > 0) {
            const zoomFactor = currentDistance / initialPinchDistance;
            const newScale = Math.max(minScale, Math.min(MAX_SCALE, initialScale * zoomFactor));

            // Use performZoom to zoom around the current pinch center
            performZoom(currentCenter.x, currentCenter.y, newScale, scale, false);
        }
    }

    if (e.touches.length > 0) {
        const touch = e.touches[0];
        updateCursorPosition(touch.clientX, touch.clientY);
    }
});

canvas.addEventListener('touchend', e => {
    e.preventDefault();

    // Check for completed photo tap or pixel selection (single finger touch end)
    if (e.changedTouches.length === 1 && e.touches.length === 0) {
        if (isPixelSelectionMode) {
            // Don't select pixel if this was the end of a touch drag
            if (touchDragOccurred) {
                touchDragOccurred = false; // Reset for next interaction
                return;
            }

            // In pixel selection mode, select the touched pixel
            const touch = e.changedTouches[0];
            updateCursorPosition(touch.clientX, touch.clientY);
            const mapX = Math.floor((cursorX - offsetX) / (PIXEL_SIZE * scale));
            const mapY = Math.floor((cursorY - offsetY) / (PIXEL_SIZE * scale));

            if (mapX >= 0 && mapX < MAP_COLS && mapY >= 0 && mapY < MAP_ROWS) {
                selectedPixel = { x: mapX, y: mapY };
                document.body.classList.add('show-confirm');
                drawMap(mapData); // Redraw to show selected pixel
                handlePixelSelection(mapX, mapY);
            }
        } else if (pendingPhotoTap) {
            // Normal photo tap
            const photo = pendingPhotoTap;
            pendingPhotoTap = null; // Clear it

            // Photo tap detected - zoom in/out
            if (scale < MAX_SCALE) {
                // Zoom to maximum scale with photo centered in canvas
                const oldScale = scale;
                const newScale = MAX_SCALE;
                const cssDims = getCanvasCSSDimensions();
                const targetOffsetX = cssDims.width / 2 - (photo.imageX + 0.5) * PIXEL_SIZE * MAX_SCALE;
                const targetOffsetY = cssDims.height / 2 - (photo.imageY + 0.5) * PIXEL_SIZE * MAX_SCALE;
                const centerX = (targetOffsetX - offsetX * MAX_SCALE / scale) / (1 - MAX_SCALE / scale);
                const centerY = (targetOffsetY - offsetY * MAX_SCALE / scale) / (1 - MAX_SCALE / scale);

                performZoom(centerX, centerY, newScale, oldScale, true, 500); // Enable animation

                // Show photo view after zoom animation completes and image loads
                setTimeout(() => {
                    showPhotoView(photo);
                }, 500);
            } else if (scale == MAX_SCALE) {
                // Already at max zoom - just center the photo and show photo view
                const cssDims = getCanvasCSSDimensions();
                const targetOffsetX = cssDims.width / 2 - (photo.imageX + 0.5) * PIXEL_SIZE * MAX_SCALE;
                const targetOffsetY = cssDims.height / 2 - (photo.imageY + 0.5) * PIXEL_SIZE * MAX_SCALE;

                // Animate to center the photo
                animateToOffsets(targetOffsetX, targetOffsetY);

                // Show photo view after animation
                setTimeout(() => {
                    showPhotoView(photo);
                }, 300); // Shorter duration since we're not zooming
            }
        }
        return;
    }


    isDragging = false;
    initialPinchDistance = 0;
    wasMultiTouch = false; // Reset multi-touch flag
    pendingPhotoTap = null; // Clear any pending photo tap
});

function resizeCanvas() {
    const devicePixelRatio = window.devicePixelRatio || 1;

    // Set canvas CSS size (display size)
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';

    // Set canvas buffer size (actual pixels for crisp rendering)
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;

    // Scale the drawing context to account for device pixel ratio
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Disable image smoothing for pixel-perfect rendering
    ctx.imageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.msImageSmoothingEnabled = false;

    scale = Math.max(canvas.width / devicePixelRatio / (MAP_COLS * PIXEL_SIZE), canvas.height / devicePixelRatio / (MAP_ROWS * PIXEL_SIZE));
    minScale = scale;

    // Update MAX_SCALE so that at max zoom, one pixel fills the canvas
    MAX_SCALE = Math.min(canvas.width / devicePixelRatio / PIXEL_SIZE, canvas.height / devicePixelRatio / PIXEL_SIZE);

    // Clamp offsets to ensure map stays within new canvas bounds
    clampOffsets(offsetX, offsetY);

    if (mapData.length > 0) {
        drawMap(mapData);
    }
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

canvas.addEventListener('mousedown', e => {
    isDragging = true;
    dragOccurred = false; // Reset drag detection
    document.body.classList.add('dragging-cursor');
    document.body.classList.remove('show-photo-view'); // Hide photo view on interaction
    dragStartX = e.clientX - offsetX;
    dragStartY = e.clientY - offsetY;
});

canvas.addEventListener('mousemove', e => {
    if (isDragging) {
        // Check if mouse has moved beyond drag threshold
        const deltaX = e.clientX - (offsetX + dragStartX);
        const deltaY = e.clientY - (offsetY + dragStartY);
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        if (distance > DRAG_THRESHOLD) {
            dragOccurred = true; // Mark that dragging actually occurred
        }

        clampOffsets(e.clientX - dragStartX, e.clientY - dragStartY);
        drawMap(mapData);
    }
});

canvas.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.classList.remove('dragging-cursor')
});

canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    document.body.classList.remove('dragging-cursor');
    canvas.classList = "";
});

// Double-click to zoom in
canvas.addEventListener('dblclick', e => {
    e.preventDefault();
    document.body.classList.remove('show-photo-view'); // Hide photo view on interaction
    updateCursorPosition(e.clientX, e.clientY);
    const oldScale = scale;
    const newScale = Math.min(MAX_SCALE, scale * 2); // Zoom in by 2x

    performZoom(cursorX, cursorY, newScale, oldScale, true); // Enable animation
});

// Single click to zoom to photo or zoom out
canvas.addEventListener('click', e => {
    e.preventDefault();
    updateCursorPosition(e.clientX, e.clientY);

    // Don't select pixel if this was the end of a drag
    if (dragOccurred) {
        dragOccurred = false; // Reset for next interaction
        return;
    }

    if (isPixelSelectionMode) {
        // In pixel selection mode, select the clicked pixel
        const mapX = Math.floor((cursorX - offsetX) / (PIXEL_SIZE * scale));
        const mapY = Math.floor((cursorY - offsetY) / (PIXEL_SIZE * scale));

        if (mapX >= 0 && mapX < MAP_COLS && mapY >= 0 && mapY < MAP_ROWS) {
            selectedPixel = { x: mapX, y: mapY };
            document.body.classList.add('show-confirm');
            drawMap(mapData); // Redraw to show selected pixel
            handlePixelSelection(mapX, mapY);
        }
    } else {
        // Normal photo zoom behavior
        const mapX = Math.floor((cursorX - offsetX) / (PIXEL_SIZE * scale));
        const mapY = Math.floor((cursorY - offsetY) / (PIXEL_SIZE * scale));

        // Check for photos within a 2-pixel radius for better targeting
        let photo = null;
        const touchTolerance = 0;
        for (let dx = -touchTolerance; dx <= touchTolerance && !photo; dx++) {
            for (let dy = -touchTolerance; dy <= touchTolerance && !photo; dy++) {
                const checkX = mapX + dx;
                const checkY = mapY + dy;
                photo = photos.find(p => p.imageX === checkX && p.imageY === checkY);
            }
        }
        if (photo) {
            if (scale < MAX_SCALE) {
                // Zoom to maximum scale with photo centered in canvas
                const oldScale = scale;
                const newScale = MAX_SCALE;
                const cssDims = getCanvasCSSDimensions();
                const targetOffsetX = cssDims.width / 2 - (photo.imageX + 0.5) * PIXEL_SIZE * MAX_SCALE;
                const targetOffsetY = cssDims.height / 2 - (photo.imageY + 0.5) * PIXEL_SIZE * MAX_SCALE;
                const centerX = (targetOffsetX - offsetX * MAX_SCALE / scale) / (1 - MAX_SCALE / scale);
                const centerY = (targetOffsetY - offsetY * MAX_SCALE / scale) / (1 - MAX_SCALE / scale);

                performZoom(centerX, centerY, newScale, oldScale, true, 500); // Enable animation

                // Show photo view after zoom animation completes and image loads
                setTimeout(() => {
                    showPhotoView(photo);
                }, 500);
            } else if (scale == MAX_SCALE) {
                // Already at max zoom - just center the photo and show photo view
                const cssDims = getCanvasCSSDimensions();
                const targetOffsetX = cssDims.width / 2 - (photo.imageX + 0.5) * PIXEL_SIZE * MAX_SCALE;
                const targetOffsetY = cssDims.height / 2 - (photo.imageY + 0.5) * PIXEL_SIZE * MAX_SCALE;

                // Animate to center the photo
                animateToOffsets(targetOffsetX, targetOffsetY);

                // Show photo view after animation
                setTimeout(() => {
                    showPhotoView(photo);
                }, 300); // Shorter duration since we're not zooming
            }
        }
    }
});

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    document.body.classList.remove('show-photo-view'); // Hide photo view on interaction
    const zoom = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
    const oldScale = scale;

    performZoom(cursorX, cursorY, scale * zoom, oldScale);
});

function drawMap(mapData) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#9EC9EB';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawGrid();

    // Calculate visible tile range for performance optimization
    const cssDims = getCanvasCSSDimensions();
    const tileSize = PIXEL_SIZE * scale;
    const startX = Math.max(0, Math.floor(-offsetX / tileSize));
    const endX = Math.min(MAP_COLS, Math.ceil((cssDims.width - offsetX) / tileSize));
    const startY = Math.max(0, Math.floor(-offsetY / tileSize));
    const endY = Math.min(MAP_ROWS, Math.ceil((cssDims.height - offsetY) / tileSize));

    // Only render visible tiles
    for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
            const code = mapData[y][x];
            const color = colorMap[code] || "#ffffff";

            if (code != "w") {
                ctx.fillStyle = color;
                ctx.fillRect(
                    Math.floor(x * PIXEL_SIZE * scale + offsetX),
                    Math.floor(y * PIXEL_SIZE * scale + offsetY),
                    Math.ceil(PIXEL_SIZE * scale),
                    Math.ceil(PIXEL_SIZE * scale)
                );
            }
        }
    }

    if (!isPixelSelectionMode) {
        drawPhotos();
    } else {
        // Draw pixel selection highlights in pixel selection mode

        // Draw selected pixel as solid white
        if (selectedPixel) {
            const { x, y } = selectedPixel;
            const screenX = Math.floor(x * PIXEL_SIZE * scale + offsetX);
            const screenY = Math.floor(y * PIXEL_SIZE * scale + offsetY);
            const screenSize = Math.ceil(PIXEL_SIZE * scale);

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(screenX, screenY, screenSize, screenSize);
        }

        // Draw hovered pixel highlight (on top of selected pixel if they're the same)
        if (hoveredPixel && cursorInsideCanvas) {
            const { x, y } = hoveredPixel;
            const screenX = Math.floor(x * PIXEL_SIZE * scale + offsetX);
            const screenY = Math.floor(y * PIXEL_SIZE * scale + offsetY);
            const screenSize = Math.ceil(PIXEL_SIZE * scale);

            // Draw highlight border
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(screenX + 1, screenY + 1, screenSize - 2, screenSize - 2);

            // Draw semi-transparent overlay
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fillRect(screenX, screenY, screenSize, screenSize);
        }
    }

    drawBoroughLabels();
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    const cssDims = getCanvasCSSDimensions();
    const tileSize = PIXEL_SIZE * scale;
    const startX = Math.max(0, Math.floor(-offsetX / tileSize));
    const endX = Math.min(MAP_COLS, Math.ceil((cssDims.width - offsetX) / tileSize));
    const startY = Math.max(0, Math.floor(-offsetY / tileSize));
    const endY = Math.min(MAP_ROWS, Math.ceil((cssDims.height - offsetY) / tileSize));

    for (let x = startX; x <= endX; x++) {
        const lineX = Math.floor(x * PIXEL_SIZE * scale + offsetX) + 0.5;
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, cssDims.height);
    }

    for (let y = startY; y <= endY; y++) {
        const lineY = Math.floor(y * PIXEL_SIZE * scale + offsetY) + 0.5;
        ctx.moveTo(0, lineY);
        ctx.lineTo(cssDims.width, lineY);
    }

    ctx.stroke();
}

function drawPhotos() {
    const tileSize = PIXEL_SIZE * scale;
    const startX = Math.max(0, Math.floor(-offsetX / tileSize));
    const endX = Math.min(MAP_COLS, Math.ceil((canvas.width - offsetX) / tileSize));
    const startY = Math.max(0, Math.floor(-offsetY / tileSize));
    const endY = Math.min(MAP_ROWS, Math.ceil((canvas.height - offsetY) / tileSize));
    const fadeStart = minScale * 3;
    const fadeEnd = minScale * 5;
    const fadeAlpha = Math.max(0, Math.min(1, (scale - fadeStart) / (fadeEnd - fadeStart)));

    for (const photo of photos) {
        const x = photo.imageX;
        const y = photo.imageY;
        if (x < startX || x >= endX || y < startY || y >= endY) continue;

        const screenX = Math.floor(x * PIXEL_SIZE * scale + offsetX);
        const screenY = Math.floor(y * PIXEL_SIZE * scale + offsetY);
        const screenSize = Math.ceil(PIXEL_SIZE * scale);

        // Always draw the base color block
        ctx.fillStyle = clampHexToHSL(photo.color);
        ctx.fillRect(screenX, screenY, screenSize, screenSize);

        // Overlay the image with a fade between 4x and 5x
        if (fadeAlpha > 0 && photo.imageLowRes) {
            let img = imageCache.get(photo.imageLowRes);
            if (!img) {
                img = new Image();
                img.src = photo.imageLowRes;
                imageCache.set(photo.imageLowRes, img);
                img.onload = () => {
                    // Redraw once the image finishes loading
                    drawMap(mapData);
                };
            }

            if (img.complete && img.naturalWidth > 0) {
                const prevAlpha = ctx.globalAlpha;
                ctx.globalAlpha = fadeAlpha;
                ctx.drawImage(img, screenX, screenY, screenSize, screenSize);
                ctx.globalAlpha = prevAlpha;
            }
        }
    }
}

function drawBoroughLabels() {
    const baseFontSize = 20;
    const maxFontSize = 60;
    const fontSize = Math.max(baseFontSize, Math.min(maxFontSize, baseFontSize * scale * 0.5));

    ctx.font = `400 ${fontSize}px Tiny5, -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const boroughs = [
        { name: 'MANHATTAN', x: 8.15, y: 24, color: '#ffffff' },
        { name: 'THE BRONX', x: 17, y: 7, color: '#ffffff' },
        { name: 'BROOKLYN', x: 27, y: 40, color: '#ffffff' },
        { name: 'QUEENS', x: 31, y: 24, color: '#ffffff' }
    ];

    boroughs.forEach(borough => {
        const screenX = borough.x * PIXEL_SIZE * scale + offsetX;
        const screenY = borough.y * PIXEL_SIZE * scale + offsetY;

        const cssDims = getCanvasCSSDimensions();
        if (screenX >= -100 && screenX <= cssDims.width + 100 &&
            screenY >= -50 && screenY <= cssDims.height + 50) {

            ctx.fillStyle = borough.color;
            ctx.fillText(borough.name, screenX, screenY);
        }
    });
}

function getTouchDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touch1, touch2, rect) {
    return {
        x: ((touch1.clientX + touch2.clientX) / 2) - rect.left,
        y: ((touch1.clientY + touch2.clientY) / 2) - rect.top
    };
}