import { generateOfferTextWithDeepSeek } from "@/features/ai/deepseek";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const text = await generateOfferTextWithDeepSeek({
      customerName: body.customerName ?? "",
      projectName: body.projectName ?? "",
      location: body.location,
      serviceType: body.serviceType ?? "",
      duration: body.duration,
      projectStartDate: body.projectStartDate,
      positions: Array.isArray(body.positions) ? body.positions : [],
      technicalSpecifications: body.technicalSpecifications,
      additionalNotes: body.additionalNotes,
      serviceSpecificGuidance: body.serviceSpecificGuidance,
      companyName: body.companyName,
      paymentTerms: body.paymentTerms,
      agbReference: body.agbReference,
      companyIntroText: body.companyIntroText,
      companyClosingText: body.companyClosingText,
    });

    return Response.json({ text });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Angebotstext konnte nicht generiert werden.",
      },
      { status: 500 }
    );
  }
}
