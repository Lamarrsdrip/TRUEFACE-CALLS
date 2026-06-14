from __future__ import annotations

from email.message import EmailMessage
import smtplib
import ssl

import httpx


def send_email(
    values: dict[str, str],
    recipient: str,
    subject: str,
    text: str,
) -> None:
    provider = values.get("provider", "").lower()
    sender_email = values["senderEmail"]
    sender_name = values.get("senderName", "TrueFace Calls")
    if provider == "resend":
        response = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {values['apiKey']}"},
            json={
                "from": f"{sender_name} <{sender_email}>",
                "to": [recipient],
                "subject": subject,
                "text": text,
            },
            timeout=10,
        )
        response.raise_for_status()
        return

    message = EmailMessage()
    message["From"] = f"{sender_name} <{sender_email}>"
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text)

    if provider == "gmail":
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10) as smtp:
            smtp.login(sender_email, values["appPassword"])
            smtp.send_message(message)
        return

    if provider == "smtp":
        host = values["host"]
        port = int(values["port"])
        secure = values.get("secure", "starttls").lower()
        if secure == "ssl":
            with smtplib.SMTP_SSL(host, port, timeout=10) as smtp:
                smtp.login(values["username"], values["password"])
                smtp.send_message(message)
            return
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            if secure == "starttls":
                smtp.starttls(context=ssl.create_default_context())
            smtp.login(values["username"], values["password"])
            smtp.send_message(message)
        return

    raise ValueError("Unsupported email provider")
