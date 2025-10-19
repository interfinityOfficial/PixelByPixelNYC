const alertBox = document.getElementById('alert-box');
const alertText = document.getElementById('alert-text');
const alertDismissButton = document.getElementById('alert-dismiss');
const alertActionButton = document.getElementById('alert-action');
const logoutButton = document.getElementById('logout-button');
let alertAction = null;

alertDismissButton.addEventListener('click', () => {
    document.body.classList = "";
});

alertActionButton.addEventListener('click', () => {
    document.body.classList = "";
    if (alertAction) {
        alertAction();
    }
    alertAction = null;
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

logoutButton.addEventListener('click', () => {
    showAlert('ARE YOU SURE YOU WANT TO LOGOUT?', 'CANCEL', 'LOGOUT', () => {
        fetch(`/logout/`, {
            method: 'GET',
        }).then(response => {
            if (response.ok) {
                window.location.href = '/';
            } else {
                showAlert('FAILED TO LOGOUT', 'Dismiss', null);
            }
        }).catch(error => {
            showAlert('FAILED TO LOGOUT', 'Dismiss', null);
        });
    });
});

document.querySelectorAll('.photo-coords').forEach(photoCoords => {
    photoCoords.addEventListener('keypress', function (event) {
        if (event.keyCode === 13) { // Check for Enter key
            event.preventDefault();
            photoCoords.blur();
        } else if (photoCoords.textContent.trim().length >= 6) {
            event.preventDefault();
        }
    });

    photoCoords.addEventListener('blur', () => {
        const value = photoCoords.textContent;
        const [x, y] = value.split(',');
        if (isNaN(x) || isNaN(y)) {
            photoCoords.textContent = photoCoords.getAttribute('data-photo-coords');
            return;
        }
        if (parseInt(x) > 44 || parseInt(y) > 53) {
            photoCoords.textContent = photoCoords.getAttribute('data-photo-coords');
            return;
        }
        const photoId = photoCoords.getAttribute('data-photo-id');
        console.log(photoId, x, y);
        fetch(`/update-photo/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ photoId, x, y }),
        }).then(response => response.json()).then(data => {
            if (data.success) {
                photoCoords.textContent = `${x}, ${y}`;
                photoCoords.setAttribute('data-photo-coords', `${x}, ${y}`);
            } else {
                photoCoords.textContent = photoCoords.getAttribute('data-photo-coords');
            }
        }).catch(error => {
            photoCoords.textContent = photoCoords.getAttribute('data-photo-coords');
        });
    });
});

document.querySelectorAll('.photo-action-button').forEach(photoActionButton => {
    photoActionButton.addEventListener('click', () => {
        const photoId = photoActionButton.getAttribute('data-photo-id');
        showAlert('ARE YOU SURE YOU WANT TO DELETE THIS PHOTO?', 'CANCEL', 'DELETE', () => {
            fetch(`/delete-photo/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ photoId }),
            }).then(response => response.json()).then(data => {
                if (data.success) {
                    document.getElementById(`photo-${photoId}`).remove();
                    if (document.getElementById('photos').children.length === 0) {
                        let noPhotos = document.createElement('div');
                        noPhotos.classList.add('no-photos');
                        noPhotos.textContent = 'NO PHOTOS YET';
                        document.getElementById('photos').appendChild(noPhotos);
                    }
                    document.body.classList = "";
                } else {
                    showAlert('FAILED TO DELETE PHOTO', 'Dismiss', null);
                }
            }).catch(error => {
                showAlert('FAILED TO DELETE PHOTO', 'Dismiss', null);
            });
        });
    });
});