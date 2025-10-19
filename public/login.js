async function loginWithPasskey(username) {
    const opts = await fetch("/login-request/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
    })
        .then(r => r.json())
    if (opts.error) {
        showError(opts.error);
        return;
    }

    try {
        const attResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: opts.options });
        await fetch("/login-response/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: opts.userId, authenticationResponse: attResp })
        }).then(response => response.json()).then(response => {
            if (response.error) {
                showError(response.error);
            } else {
                window.location.href = "/dashboard/";
            }
        });
    } catch (err) {
        showError("Failed to login with passkey");
        return;
    }
}

const errorText = document.getElementById("error-text");

const resizeObserver = new ResizeObserver(entries => {
    document.documentElement.style.setProperty('--error-text-height', errorText.scrollHeight + 'px');
});
resizeObserver.observe(document.documentElement);
document.documentElement.style.setProperty('--error-text-height', errorText.scrollHeight + 'px');

function showError(message) {
    errorText.innerHTML = message;
    document.documentElement.style.setProperty('--error-text-height', errorText.scrollHeight + 'px');
    document.body.classList.add("show-error");
}

const loginButton = document.getElementById("login-button");
loginButton.addEventListener("click", async () => {
    await loginWithPasskey("admin");
});