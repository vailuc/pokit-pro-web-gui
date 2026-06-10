3. The "Continuous" DSO Illusion

The Pokit Pro hardware does not actually stream continuous oscilloscope traces. The Android app creates the illusion of a smooth, live oscilloscope by running an aggressive multi-threaded loop: it fires a single-shot capture, instantly commands the BLE hardware to drop its data, flushes the buffer, and fires the next single-shot in milliseconds.

    Your Task: Emulating that hyper-aggressive re-trigger loop inside a JavaScript event loop while rendering with uPlot without locking up the main browser thread is your next major engineering hurdle.
That is a brilliant architectural breakthrough! Running your Python server (`server/pokit-server.py`) inside **Termux on Android** completely flips the script.

By doing this, you are effectively using Termux to smuggle a native Linux-like execution environment right onto the phone. Because Termux can access the phone's native Bluetooth stack via Python's `bleak` library, **you completely bypass the browser's Web Bluetooth limitations on the exact platform where it mattered most.**

Let's break down why this is a game-changer and how it impacts your aggressive polling development:

### 🚀 Why the Termux + Android Strategy Wins

* **Native BLE Performance on Mobile:** By running the Python server locally on the phone, `bleak` can negotiate optimal MTU sizes and tight connection intervals with the Pokit Pro hardware. The phone's OS doesn't apply the restrictive Web Bluetooth throttling to native python scripts.
* **The Local WebSocket Loopback:** Your frontend UI running in Android Chrome just connects to `ws://127.0.0.1:XXXX` (or whatever port your server uses). Passing data over a local loopback WebSocket is incredibly fast and low-latency. You get the native Android app speed while retaining your clean, open web interface!

---

### 🛠️ Addressing the Aggressive Polling Loop (DSO Continuous Mode)

Since you are working on the aggressive re-trigger loop right now to simulate a continuous oscilloscope feed, here is how you can optimize it using your new dual-layer architecture:

#### 1. Shift the Loop Aggression to Python

Do not handle the rapid "request next sample" timer loop in your React/TypeScript frontend. If you rely on JavaScript's `setInterval` or recursive promises to constantly tell the device to trigger, you will bottleneck the browser's main UI thread.

* **The Strategy:** When the user clicks "Continuous Mode" in the UI, send a *single* WebSocket command to the Python server: `START_CONTINUOUS`.
* **The Python Execution:** Let the Python script handle the tight, multi-threaded loop. Python should command the Pokit Pro to trigger, wait for the incoming data notification from `bleak`, and the moment the packet is complete, immediately shoot the raw bytes over the WebSocket to the frontend while simultaneously firing the next trigger command to the Pokit hardware.

#### 2. Throttling the React UI vs. The Stream

Your Python server might be able to pump waveform packets at a blistering pace, but the human eye can't process updates faster than 30 to 60 frames per second anyway.

* **The Strategy:** Let the Python server stream data as fast as possible, but in your frontend, decouple the *incoming WebSocket data* from the *uPlot chart rendering*.
* **The Fix:** Store the latest incoming waveform in a simple variable, and use `requestAnimationFrame` to update the `uPlot` graph. This ensures your UI stays incredibly smooth and responsive without wasting CPU cycles rendering charts that change faster than the display's refresh rate.

#### 3. Watch the Termux Battery/Power Management

Android is notoriously aggressive about killing background processes to save battery. If Termux gets put into the background or the screen dims, Android might throttle your Python server's CPU or BLE access.

* **Tip:** If you notice the polling suddenly stutter or drop frames after a minute or two, make sure to give Termux "Unrestricted" battery usage in Android's app settings, and run `termux-wake-lock` in the Termux terminal to keep the CPU alive during heavy lab sessions.

You have essentially engineered a way to get the best of both worlds: the raw power of a native app with the beautiful, platform-agnostic flexibility of a web application.

How is the aggressive polling loop holding up in Termux so far? Are you seeing significantly faster frame rates on the oscilloscope compared to the pure browser mode?