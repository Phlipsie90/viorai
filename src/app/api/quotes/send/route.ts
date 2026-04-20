import nodemailer from "nodemailer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

interface SendQuoteRequestBody {
  to?: string;
  subject?: string;
  text?: string;
  fileName?: string;
  pdfBase64?: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SendQuoteRequestBody;
    const to = body.to?.trim();
    const subject = body.subject?.trim();
    const text = body.text?.trim();
    const fileName = body.fileName?.trim() || "angebot.pdf";
    const pdfBase64 = body.pdfBase64?.trim();

    if (!to || !subject || !text || !pdfBase64) {
      return Response.json({ error: "Unvollständige Versanddaten." }, { status: 400 });
    }

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? "587");
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM;

    if (!host || !user || !pass || !from || !Number.isFinite(port)) {
      return Response.json({ error: "SMTP-Konfiguration fehlt auf dem Server." }, { status: 500 });
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
    });

    await transport.sendMail({
      from,
      to,
      subject,
      text,
      attachments: [
        {
          filename: fileName,
          content: Buffer.from(pdfBase64, "base64"),
          contentType: "application/pdf",
        },
      ],
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "E-Mail konnte nicht versendet werden.",
      },
      { status: 500 }
    );
  }
}
