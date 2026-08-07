import mainTemplate from "../views/main.html";
import loginTemplate from "../views/login.html";
import dashboardTemplate from "../views/dashboard.html";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMain({ photos, isAdmin }) {
  const adminLink = isAdmin
    ? `<a href="/dashboard/" class="login-link">ADMIN DASHBOARD</a>`
    : `<a href="/login/" class="login-link">ADMIN LOGIN</a>`;

  return mainTemplate
    .replace("<!--ADMIN_LINK-->", adminLink)
    .replace("<!--YEAR-->", String(new Date().getFullYear()))
    .replace("<!--PHOTOS_JSON-->", JSON.stringify(photos));
}

export function renderLogin() {
  return loginTemplate.replace(
    "<!--YEAR-->",
    String(new Date().getFullYear())
  );
}

export function renderDashboard({ photos }) {
  let photosHtml;
  if (!photos.length) {
    photosHtml = `<div class="no-photos">NO PHOTOS YET</div>`;
  } else {
    photosHtml = photos
      .map((photo) => {
        const id = escapeHtml(photo.id);
        const x = escapeHtml(photo.imageX);
        const y = escapeHtml(photo.imageY);
        const high = escapeHtml(photo.imageHighRes);
        const low = escapeHtml(photo.imageLowRes);
        return `<div class="photo" id="photo-${id}">
          <a href="${high}" target="_blank" class="photo-link">
            <img src="${low}" alt="Photo" class="photo-image" />
          </a>
          <div class="photo-info">
            <div
              class="photo-coords"
              contenteditable="true"
              data-photo-coords="${x}, ${y}"
              data-photo-id="${id}"
            >
              ${x}, ${y}
            </div>
            <div class="photo-actions">
              <button class="photo-action-button" data-photo-id="${id}">
                <svg class="delete-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50">
                  <g id="Layer_1-2" data-name="Layer_1">
                    <g>
                      <rect x="40" width="10" height="10" />
                      <rect x="30" y="10" width="10" height="10" />
                      <rect x="20" y="20" width="10" height="10" />
                      <rect x="10" y="10" width="10" height="10" />
                      <rect width="10" height="10" />
                      <rect y="40" width="10" height="10" />
                      <rect x="10" y="30" width="10" height="10" />
                      <rect x="40" y="40" width="10" height="10" />
                      <rect x="30" y="30" width="10" height="10" />
                    </g>
                  </g>
                </svg>
              </button>
            </div>
          </div>
        </div>`;
      })
      .join("\n");
  }

  return dashboardTemplate.replace("<!--PHOTOS-->", photosHtml);
}

export function html(body, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { ...init, headers });
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}
