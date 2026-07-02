# Graduation Issue — Draft for GitHub

Copy-paste the title and body below into a new GitHub issue, then pin it.

---

## Title

Project status: Graduated to Forge Open Bench (FOB) Full Ecosystem

## Body

> This repository served its purpose beautifully as a Proof of Concept for a dual-backend, browser-based Pokit Pro interface. Thanks to everyone who cloned, dug into the screenshots, or reviewed the architecture notes over the last few weeks.

**Where we hit limits:**
While the "Time Machine" history buffer and dual-backend switching worked well, browser environments and the standard Web Bluetooth API ultimately restrict what we can pull out of high-performance instrumentation hardware without invasive dependencies or telemetry creeping in.

Specific bottlenecks encountered:
- Web Bluetooth MTU caps and notification batching limit DSO sample throughput
- Browser sandboxing prevents native USB instrument access
- No unified bench view across multiple instrument families (Pokit, Hantek, Saleae)

**The Next Phase:**
To solve this properly, the core architecture and protocol work have been ported into **Forge Open Bench (FOB)** — a clean-room, full GUI desktop environment. Moving to FOB allows us to support:

- Pure local-only, zero-telemetry hardware capture
- Native USB bridging without browser-enforced data throttling
- Unified 16-channel digital logic views alongside standard DSO and multimeter modules
- Hantek DSO and Saleae Logic Analyzer support

This repository is now a **static archive** for historical reference. The code remains functional and was verified against real Pokit Pro hardware.

See you over at the main FOB repo! 🛠️

👉 **[github.com/marcus-louie/forge-open-bench](https://github.com/marcus-louie/forge-open-bench)**
