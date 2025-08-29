/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { marked } from 'marked';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// --- DOM Elements ---
const userInput = document.querySelector('#input') as HTMLTextAreaElement;
const slideshow = document.querySelector('#slideshow') as HTMLDivElement;
const errorEl = document.querySelector('#error') as HTMLDivElement;
const modelOutput = document.querySelector('#output') as HTMLDivElement;
const examples = document.querySelectorAll('#examples li');
const themeToggle = document.querySelector('#theme-toggle') as HTMLButtonElement;
const actionsContainer = document.querySelector('#actions') as HTMLDivElement;

// --- Theme Management ---
function applyTheme(theme: 'light' | 'dark') {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark-theme');
  } else {
    document.documentElement.classList.remove('dark-theme');
  }
  localStorage.setItem('theme', theme);
}

themeToggle.addEventListener('click', () => {
  const currentTheme = document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light';
  applyTheme(currentTheme === 'light' ? 'dark' : 'light');
});

// Initialize theme on load
const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
if (savedTheme) {
  applyTheme(savedTheme as 'light' | 'dark');
} else {
  applyTheme(prefersDark ? 'dark' : 'light');
}

// --- UI Functions ---
function setLoading(isLoading: boolean) {
  userInput.disabled = isLoading;
}

function clearUI() {
  modelOutput.innerHTML = '';
  slideshow.innerHTML = '';
  actionsContainer.innerHTML = '';
  errorEl.innerHTML = '';
  slideshow.toggleAttribute('hidden', true);
  errorEl.toggleAttribute('hidden', true);
}

async function addSlide(text: string, image: HTMLImageElement) {
  const slide = document.createElement('div');
  slide.className = 'slide';
  const caption = document.createElement('div');
  caption.innerHTML = await marked.parse(text);
  slide.append(image);
  slide.append(caption);
  slideshow.append(slide);
}

function createDownloadButton() {
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download as PDF';
    downloadBtn.className = 'download-btn';
    downloadBtn.addEventListener('click', async () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Generating PDF...';
        try {
            await downloadSlidesAsPDF();
        } catch(e) {
            console.error("Failed to generate PDF", e);
            showError(`Failed to generate PDF: ${e.message}`);
        } finally {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download as PDF';
        }
    });
    actionsContainer.append(downloadBtn);
}

function showError(message: string) {
  errorEl.textContent = `Something went wrong: ${message}`;
  errorEl.removeAttribute('hidden');
}

// --- Core Generation Logic ---
async function generate(message: string) {
  setLoading(true);
  clearUI();

  try {
    const userTurn = document.createElement('div');
    userTurn.innerHTML = await marked.parse(message);
    userTurn.className = 'user-turn';
    modelOutput.append(userTurn);
    userInput.value = '';

    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status} - ${response.statusText}`;
        try {
            // Try to parse as JSON, which is what our /api/generate endpoint should return on error
            const err = await response.json();
            errorMessage = err.error?.message || errorMessage;
        } catch (e) {
            // If JSON parsing fails, the response is not what we expected. Use the raw text.
            const textError = await response.text();
            errorMessage = textError || errorMessage;
        }
        throw new Error(errorMessage);
    }

    if (!response.body) {
        throw new Error("Response body is empty.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let img: HTMLImageElement | null = null;
    let doneStreaming = false;

    // Process the stream
    while (!doneStreaming) {
      const { value, done } = await reader.read();
      if (done) {
        doneStreaming = true;
        break;
      }

      const chunkString = decoder.decode(value);
      const lines = chunkString.split('\n\n').filter(line => line.startsWith('data: '));
      
      for (const line of lines) {
        const jsonString = line.replace('data: ', '');
        try {
          const chunk = JSON.parse(jsonString);
          for (const candidate of chunk.candidates) {
            for (const part of candidate.content.parts ?? []) {
              if (part.text) {
                text += part.text;
              } else if (part.inlineData?.data) {
                img = document.createElement('img');
                img.src = `data:image/png;base64,` + part.inlineData.data;
              }

              if (text && img) {
                await addSlide(text, img);
                slideshow.removeAttribute('hidden');
                text = '';
                img = null;
              }
            }
          }
        } catch (e) {
          console.error("Error parsing stream chunk:", e);
        }
      }
    }

    if (slideshow.children.length > 0) {
        createDownloadButton();
    }

  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(false);
    userInput.focus();
  }
}

// --- PDF Download Logic ---
async function downloadSlidesAsPDF() {
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: 'a4',
    });

    const slides = slideshow.querySelectorAll('.slide');
    const pdfWidth = doc.internal.pageSize.getWidth();
    const pdfHeight = doc.internal.pageSize.getHeight();

    for (let i = 0; i < slides.length; i++) {
        const slide = slides[i] as HTMLElement;
        const canvas = await html2canvas(slide, {
          scale: 2, // Higher scale for better quality
          backgroundColor: document.documentElement.classList.contains('dark-theme') ? '#343a40' : '#ffffff',
        });
        const imgData = canvas.toDataURL('image/png');

        const imgProps = doc.getImageProperties(imgData);
        const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

        let height = imgHeight;
        let width = pdfWidth;

        // If image is too tall, scale by height instead
        if (height > pdfHeight) {
            height = pdfHeight;
            width = (imgProps.width * pdfHeight) / imgProps.height;
        }

        if (i > 0) {
            doc.addPage();
        }
        
        // Center the image on the page
        const x = (pdfWidth - width) / 2;
        const y = (pdfHeight - height) / 2;

        doc.addImage(imgData, 'PNG', x, y, width, height);
    }
    doc.save('tiny-cat-explainer.pdf');
}

// --- Event Listeners ---
userInput.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const message = userInput.value.trim();
    if (message) {
      await generate(message);
    }
  }
});

examples.forEach((li) =>
  li.addEventListener('click', async () => {
    const text = li.textContent?.trim();
    if (text) {
        userInput.value = text;
        await generate(text);
    }
  }),
);
