# Creatify AI - AI-Powered Campaign Video Generator

A modern, premium AI SaaS interface for generating campaign videos. Built with Next.js 14, React 18, Tailwind CSS, and Framer Motion.

![Dark Theme UI](https://via.placeholder.com/800x400?text=Creatify+AI+Preview)

## ✨ Features

- **🎨 Modern Dark Theme** - Premium, minimal design inspired by Runway & Midjourney
- **📤 Drag & Drop Upload** - Product image and reference image upload
- **🎬 Template Selection** - Carousel of video templates with preview
- **⚙️ Advanced Options** - Caption tone and mood/vibe selectors
- **🚀 Smooth Animations** - Framer Motion powered transitions
- **📱 Responsive Design** - Mobile-first approach
- **🎥 Video Preview** - Built-in player with controls

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn or pnpm

### Installation

```bash
# Navigate to project directory
cd ai-campaign-video

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 🏗️ Project Structure

```
src/
├── app/
│   ├── globals.css      # Global styles & Tailwind
│   ├── layout.tsx       # Root layout
│   └── page.tsx         # Main page
├── components/
│   ├── Header.tsx       # Navigation header
│   ├── UploadSection.tsx    # Image upload component
│   ├── TemplateSelector.tsx # Template carousel
│   ├── GenerateButton.tsx   # Animated generate button
│   ├── VideoPreview.tsx     # Video player & actions
│   ├── AdvancedOptions.tsx  # Expandable options
│   └── ProgressModal.tsx    # Generation progress
├── lib/
│   └── utils.ts         # Utility functions
└── types/
    └── index.ts         # TypeScript types
```

## 🎨 Design System

### Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Background Primary | `#0a0a0b` | Main background |
| Background Secondary | `#111113` | Cards, sections |
| Accent Primary | `#8b5cf6` | Buttons, highlights |
| Text Primary | `#fafafa` | Headings |
| Text Secondary | `#a1a1aa` | Body text |

### Components

- **Glass Morphism** - Frosted glass effect with blur
- **Gradient Borders** - Animated gradient outlines
- **Glow Effects** - Subtle purple glow on interactive elements

## 🛠️ Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion
- **Icons**: Lucide React

## 📝 License

MIT License - feel free to use for your projects!

---

Built with ❤️ for creators
