import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ClarifyingQuestions {
  questions: string[];
}

export interface GeneratedCode {
  html: string;
  css: string;
  explanation: string;
}

export async function getClarifyingQuestions(prompt: string): Promise<string[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `The user wants to generate a website or web app with the following prompt: "${prompt}". 
    Act as a world-class product designer. Generate 3-5 short, punchy clarifying questions to help you build the perfect UI. 
    Focus on:
    1. Specific aesthetic (e.g., minimalist, brutalist, futuristic).
    2. Key functional requirements (e.g., interactive elements, specific sections).
    3. Target audience or vibe.
    
    Return the questions as a JSON array of strings.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["questions"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || '{"questions": []}');
    return data.questions;
  } catch (e) {
    console.error("Failed to parse clarifying questions", e);
    return ["What is the primary goal of this app?", "What aesthetic do you prefer?", "Are there any specific features you need?"];
  }
}

export async function generateVibeCode(prompt: string, answers: Record<string, string>): Promise<GeneratedCode> {
  const context = Object.entries(answers).map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n");
  
  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `User Prompt: ${prompt}
    Clarifications:
    ${context}
    
    Task: Generate a single-file HTML/Tailwind CSS solution that is modern, stylish, and creative.
    Use Material Design 3 principles (large rounded corners, specific color palettes like primary, secondary, tertiary, and surface variants, elevation/shadows).
    Include Lucide icons via CDN if needed (use <script src="https://unpkg.com/lucide@latest"></script> and lucide.createIcons() if you use <i> tags, or just use SVG paths).
    The code should be experimental, high-quality, and visually stunning. 
    Ensure the UI is responsive and follows best practices for accessibility.
    Focus on micro-interactions, beautiful typography, and a "vibe" that matches the user's request.
    
    Return the result as a JSON object with 'html', 'css' (any custom animations or complex styles), and 'explanation'.
    The 'html' should be the content that goes inside the <body> tag, or a full document if you prefer (but I will wrap it in a standard head with Tailwind 4).
`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          html: { type: Type.STRING, description: "The full HTML code including Tailwind classes." },
          css: { type: Type.STRING, description: "Any custom CSS needed beyond Tailwind." },
          explanation: { type: Type.STRING, description: "A brief explanation of the design choices." }
        },
        required: ["html", "explanation"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}') as GeneratedCode;
  } catch (e) {
    console.error("Failed to parse generated code", e);
    return {
      html: "<h1>Error generating code</h1>",
      css: "",
      explanation: "Something went wrong during generation."
    };
  }
}

export async function refineVibeCode(previousCode: GeneratedCode, changeRequest: string, history: { role: 'user' | 'model', text: string }[]): Promise<GeneratedCode> {
  const chatContext = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join("\n");

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: `Previous Code:
    HTML: ${previousCode.html}
    CSS: ${previousCode.css}
    
    Chat History:
    ${chatContext}
    
    New Request: "${changeRequest}"
    
    Task: Modify the previous code based on the new request. Maintain the Material Design 3 aesthetic and high quality.
    Return the result as a JSON object with 'html', 'css', and 'explanation'.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          html: { type: Type.STRING },
          css: { type: Type.STRING },
          explanation: { type: Type.STRING }
        },
        required: ["html", "explanation"]
      }
    }
  });

  try {
    return JSON.parse(response.text || '{}') as GeneratedCode;
  } catch (e) {
    console.error("Failed to refine code", e);
    return previousCode;
  }
}

export async function getRefinementSuggestions(code: GeneratedCode): Promise<string[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `The following code was generated for a website:
    HTML: ${code.html}
    CSS: ${code.css}
    
    Explanation: ${code.explanation}
    
    Act as a senior UX/UI critic. Suggest 3 specific, actionable improvements or variations the user might want to make to this design. 
    Keep suggestions short (under 10 words each).
    Return as a JSON array of strings.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["suggestions"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || '{"suggestions": []}');
    return data.suggestions;
  } catch (e) {
    console.error("Failed to parse suggestions", e);
    return ["Add a dark mode toggle", "Improve mobile responsiveness", "Add more interactive hover states"];
  }
}
