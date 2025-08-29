/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, Modality} from '@google/genai';

// IMPORTANT: Set the GEMINI_API_KEY environment variable in your Vercel project settings.
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

const additionalInstructions = `
Use a fun story about lots of tiny cats as a metaphor.
Keep sentences short but conversational, casual, and engaging.
Generate a cute, minimal illustration for each sentence with black ink on white background.
No commentary, just begin your explanation.
Keep going until you're done.`;

// Vercel Edge Functions are required for streaming.
// See https://vercel.com/docs/functions/edge-functions
export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {status: 405});
  }

  try {
    const {message} = await req.json();

    if (!message) {
      return new Response('Missing message in request body', {status: 400});
    }

    const result = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash-image-preview',
      contents: message + additionalInstructions,
      config: {
        responseModalities: [Modality.TEXT, Modality.IMAGE],
      },
    });


    // Transform the stream from the API to a new ReadableStream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for await (const chunk of result) {
          // We'll just pass the JSON string of the chunk through.
          const chunkJson = JSON.stringify(chunk);
          controller.enqueue(encoder.encode(`data: ${chunkJson}\n\n`));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in generate API:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(JSON.stringify({error: {message: errorMessage}}), {
      status: 500,
      headers: {'Content-Type': 'application/json'},
    });
  }
}
