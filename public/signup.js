async function signupWithPasskey(username) {
    let error = null;
    const opts = await fetch("/signup-request/", {
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
        const attResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: opts });
        await fetch("/signup-response/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: opts.user.id, attestationResponse: attResp })
        }).then(response => response.json()).then(response => {
            if (response.error) {
                showError(response.error);
                return;
            } else {
                window.location.href = "/dashboard/";
            }
        });
    } catch (err) {
        showError("Failed to register passkey");
        return;
    }
};

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

const usernameInput = document.getElementById("username-input");
const signupButton = document.getElementById("signup-button");

usernameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.preventDefault();
        signupButton.click();
    }
    document.body.classList.remove("show-error");
});

signupButton.addEventListener("click", async () => {
    if (usernameInput.value.length === 0) {
        showError("PLEASE ENTER A USERNAME");
        return;
    }
    const username = usernameInput.value;
    await signupWithPasskey(username);
});