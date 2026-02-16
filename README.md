# Zero-Copy  Visualizer

Interactive visualizer explaining traditional buffered I/O vs zero-copy data transfer (mmap, string_view) for systems and low latency learning.

This is a small educational project that visually explains the difference between traditional buffered I/O and zero-copy data transfer techniques.

The goal is to demonstrate how data moves between disk, kernel space, user space, and application memory — and why reducing unnecessary copies improves performance and lowers CPU usage.

---

## Why I Built This

While learning about zero-copy architecture for low-latency C++ systems (quant / HFT preparation), I realized that seeing the data movement visually makes the concept much clearer than reading theory alone.

This visualizer helps me — and potentially other students — understand:

- Kernel vs user space boundaries  
- Page cache behavior  
- Memory duplication in traditional I/O  
- How `mmap` reduces copies  
- How application-level zero-copy (`std::string_view`) works  

---

## What It Shows

- Traditional buffered read flow
- mmap-based zero-copy flow
- Application-level zero-copy using views
- Simulated copy count and CPU cost differences

---

## Tech Stack

- HTML
- CSS
- Vanilla JavaScript

---

This project is meant for conceptual clarity, not production benchmarking.
