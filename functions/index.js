import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const buildPrompt = (mode, { findings = '', impression = '' }) => {
  switch (mode) {
    case 'polish':
      return `You are a pediatric radiologist. Rewrite the following ultrasound findings so they read like a formal ultrasound report using concise, standardized medical English. Do not add or remove findings—only refine wording and flow.\n\nFindings:\n${findings}`;
    case 'impression':
      return `You are a pediatric radiologist. Based ONLY on the following ultrasound findings, craft a concise Conclusion/Impression in formal ultrasound reporting language. Do not introduce new findings.\n\nFindings:\n${findings}`;
    case 'explain':
      return `당신은 소아 영상의학과 전문의입니다. 아래 초음파 소견과 Impression을 보호자가 이해하기 쉽게 한국어로 풀어쓰세요. 불안감을 줄이는 어조로 Summary와 자세한 설명을 구분해 주고, 전문 용어는 짧게 풀어서 설명합니다.\n\nFindings: ${findings}\nImpression: ${impression}`;
    default:
      throw new Error('Unsupported mode');
  }
};

export const generateReportText = onCall({ region: 'us-central1', cors: true }, async (request) => {
  const { mode, findings = '', impression = '' } = request.data || {};

  if (!mode) {
    throw new Error('mode is required');
  }
  if (!findings && mode !== 'explain') {
    throw new Error('findings are required');
  }

  const prompt = buildPrompt(mode, { findings, impression });

  try {
    const completion = await openai.responses.create({
      model: 'gpt-4o-mini',
      input: prompt,
      max_output_tokens: mode === 'explain' ? 600 : 350,
      temperature: 0.3
    });

    const text = completion.output_text?.trim() || '';
    return { text };
  } catch (error) {
    logger.error('OpenAI call failed', error);
    throw new Error('AI generation failed');
  }
});
