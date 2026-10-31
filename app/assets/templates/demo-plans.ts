// Pre-built AI Template Plans (Demo Samples)
// These represent the structure that the AI designer should produce.
// They can be used to test the template builder or as a reference for the model.

export const DEMO_TEMPLATE_PLANS = {
  cinematicLogo: {
    schemaVersion: 1,
    intentSummary: 'Cinematic logo reveal intro',
    template: {
      name: 'Cinematic Logo Reveal',
      category: 'intro',
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      fps: 30
    },
    operations: [
      {
        type: 'add-clip',
        trackType: 'video',
        name: 'Background Layer',
        in: 0,
        out: 150, // 5 seconds * 30 fps * TICKS_PER_SECOND / ... actually core calculates ticks
        offset: 0
      },
      {
        type: 'add-clip',
        trackType: 'text',
        name: 'Brand Name',
        text: 'YOUR LOGO HERE',
        in: 30, // Starts at 1s
        out: 150,
        offset: 0,
        color: '#ffffff',
        fontSize: 72
      }
    ]
  },
  promoSplitScreen: {
    schemaVersion: 1,
    intentSummary: 'High-energy split-screen promo',
    template: {
      name: 'Product Promo - Split Screen',
      category: 'promo',
      aspectRatio: '16:9',
      width: 1920,
      height: 1080,
      fps: 30
    },
    operations: [
      {
        type: 'add-clip',
        trackType: 'video',
        name: 'Left Slot',
        in: 0,
        out: 450, // 15 seconds
        offset: 0
      },
      {
        type: 'add-clip',
        trackType: 'video',
        name: 'Right Slot',
        in: 0,
        out: 450,
        offset: 0
      },
      {
        type: 'add-clip',
        trackType: 'text',
        name: 'Left Label',
        text: 'FEATURE 1',
        in: 0,
        out: 450,
        offset: 0
      },
      {
        type: 'add-clip',
        trackType: 'text',
        name: 'Right Label',
        text: 'FEATURE 2',
        in: 0,
        out: 450,
        offset: 0
      }
    ]
  }
};
