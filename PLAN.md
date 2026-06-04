# Pokit Pro Web GUI — Technical Specification (RIPER Phase 3: PLAN)

Status: APPROVED STACK — pending execution
Target device: Pokit Pro ("Sparky")
Transport: Web Bluetooth API (Chromium only, secure context / localhost)

## 1. Goal
A fully client-side, interactive web app that replicates the official Pokit app's
core functionality for the Pokit Pro: Multimeter, Oscilloscope (DSO), Data Logger,
plus device info/status. Protocol replicated clean-room from `pcolby/dokit`.

## 2. Stack
- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui (Radix primitives)
- uPlot (canvas) for DSO + Logger waveforms
- Zustand for state
- Lucide icons

## 3. Constraints / Gotchas
- Web Bluetooth: Chromium-based browsers only. Needs secure context — dev on
  `http://localhost` is allowed; any non-localhost host needs HTTPS.
- On Linux: ensure BlueZ running; `chrome://flags/#enable-experimental-web-platform-features`
  may be needed; experimental Web Bluetooth.
- All `optionalServices` UUIDs MUST be declared in `requestDevice`, else GATT access
  to them is blocked.
- All multi-byte fields are LITTLE-ENDIAN. Floats are 32-bit.

## 4. BLE Protocol Reference (from dokit, verified)

### 4.1 Status service (scan filter + device info)
- Service (Pro): `57d3a771-267c-4394-8872-78223e92aec5`
- Service (Meter): `57d3a771-267c-4394-8872-78223e92aec4`
- Characteristics:
  - Device Characteristics: `6974f5e5-0e54-45c3-97dd-29e4b5fb0849` (read)
  - Status: `3dba36e1-6120-4706-8dfd-ed9c16e569b6` (read/notify)
  - Device Name: `7f0375de-077e-4555-8f78-800494509cc3` (read/write)
  - Flash LED: `ec9bb1f3-05a9-4277-8dd0-60a7896f0d6e` (write)
  - Torch (undocumented): `aaf3f6d5-43d4-4a83-9510-dff3d858d4cc`
  - Button Press (undocumented): `8fe5b5a9-b5b4-4a7b-8ff2-87224b970f89`
- DeviceCharacteristics layout: firmwareVersion(u8 major,u8 minor), maxVoltage(u16),
  maxCurrent(u16), maxResistance(u16), maxSamplingRate(u16), samplingBufferSize(u16),
  capabilityMask(u16), macAddress(6 bytes).
- DeviceStatus enum: Idle 0, MM DcV 1, MM AcV 2, MM DcA 3, MM AcA 4, MM Res 5,
  MM Diode 6, MM Continuity 7, MM Temp 8, DSO Sampling 9, Logger Sampling 10.
- BatteryStatus: Low 0, Good 1.

### 4.2 Multimeter service
- Service: `e7481d2f-5781-442e-bb9a-fd4e3441dadc`
- Settings (write): `53dc9a7a-bc19-4280-b76b-002d0e23b078`
  - 6 bytes LE: mode(u8) + range(u8) + updateInterval(u32 ms)
- Reading (read/notify): `047d3559-8bee-423a-b229-4417fa603b90`
  - 7 bytes: status(u8) + value(float32 LE) + mode(u8) + range(u8)
- Mode: Idle 0, DcV 1, AcV 2, DcA 3, AcA 4, Resistance 5, Diode 6, Continuity 7,
  Temperature 8, Capacitance 9, ExtTemperature 10.
- MeterStatus: 0 = AutoRangeOff / NoContinuity / Ok; 1 = AutoRangeOn / Continuity;
  255 = Error.

### 4.3 DSO (Oscilloscope) service
- Service: `1569801e-1425-4a7a-b617-a4f4ed719de6`
- Settings (write): `a81af1b6-b8b3-4244-8859-3da368d2be39`
  - command(u8) + triggerLevel(float32) + mode(u8) + range(u8) +
    samplingWindow(u32 µs) + numberOfSamples(u16)
- Metadata (read/notify): `970f00ba-f46f-4825-96a8-153a5cd0cda9`
  - status(u8) + scale(float32) + mode(u8) + range(u8) + samplingWindow(u32) +
    numberOfSamples(u16) + samplingRate(u32)
- Reading (notify): `98e14f8e-536e-4f24-b4f4-1debfed0a99e` — stream of int16 samples;
  real value = sample * scale.
- Command: FreeRunning 0, RisingEdge 1, FallingEdge 2, ResendData 3.
- Mode: Idle 0, DcV 1, AcV 2, DcA 3, AcA 4. (No AutoRange allowed in DSO.)
- Status: Done 0, Sampling 1, Error 255. Max samples Pro = 16,384; up to 1 MHz.

### 4.4 Data Logger service
- Service: `a5ff3566-1fd8-4e10-8362-590a578a4121`
- Settings (write): `5f97c62b-a83b-46c6-b9cd-cac59e130a78`
  - command(u8) + arguments(u16) + mode(u8) + range(u8) + updateInterval(u32 ms) +
    timestamp(u32 epoch)
- Metadata (read/notify): `9acada2e-3936-430b-a8f7-da407d97ca6e`
  - status(u8) + scale(float32) + mode(u8) + range(u8) + updateInterval(u32) +
    numberOfSamples(u16) + timestamp(u32)
- Reading (notify): `3c669dab-fc86-411c-9498-4f9415049cc0` — int16 samples * scale.
- Command: Start 0, Stop 1, Refresh 2.
- Mode: Idle 0, DcV 1, AcV 2, DcA 3, AcA 4, Temperature 5.
- Status: Done 0, Sampling 1, BufferFull 2, Error 255.

### 4.5 Pokit Pro Ranges (range byte values)
- Voltage: 250mV=0, 2V=1, 10V=2, 30V=3, 60V=4, 125V=5, 400V=6, 600V=7, Auto=255
- Current: 500uA=0, 2mA=1, 10mA=2, 125mA=3, 300mA=4, 3A=5, 10A=6, Auto=255
- Resistance: 30=0, 75=1, 400=2, 5K=3, 10K=4, 15K=5, 40K=6, 500K=7, 700K=8, 1M=9, 3M=10, Auto=255
- Capacitance: 100nF=0, 10uF=1, 1mF=2, Auto=255

## 5. App Architecture
```
src/
  pokit/
    uuids.ts            # all service/characteristic UUIDs
    types.ts            # enums, structs, range tables
    codec.ts            # DataView LE encode/decode helpers
    connection.ts       # requestDevice, connect, getCharacteristic, cleanup
    statusService.ts
    multimeterService.ts
    dsoService.ts
    loggerService.ts
  store/
    deviceStore.ts      # connection state, device info, status/battery
    readingStore.ts     # live multimeter reading
    captureStore.ts     # DSO + logger sample buffers + metadata
  components/
    ui/                 # shadcn components
    ConnectBar.tsx      # scan/connect/disconnect, battery, device name, LED/torch
    ModeSelector.tsx
    RangeSelector.tsx
    Readout.tsx         # big primary value display w/ unit + auto-format
    Waveform.tsx        # uPlot wrapper
  views/
    MultimeterView.tsx
    OscilloscopeView.tsx
    LoggerView.tsx
    DeviceInfoView.tsx
  App.tsx               # tab layout: Meter | Scope | Logger | Device
  main.tsx
```

## 6. UX (mirrors official app presentation)
- Top ConnectBar: device name ("Sparky"), battery indicator, connect/disconnect,
  flash LED + torch toggles.
- Tabs: Multimeter / Oscilloscope / Logger / Device.
- Multimeter: large auto-formatted readout (e.g. "3.300 V"), mode buttons, range
  dropdown (with Auto), update interval slider, live via notifications.
- Oscilloscope: mode/range/trigger(level+edge)/sampling window/#samples controls,
  Run/Single buttons, uPlot waveform, computed metrics (Vpp, RMS, frequency, period,
  duty cycle).
- Logger: mode/range/interval + start time, Start/Stop/Fetch, time-series uPlot chart,
  CSV export.
- Device: firmware, max V/A/Ω, sampling buffer, MAC, status, set device name.

## 7. Value formatting
- Auto SI-prefix formatter (n/µ/m/k/M) keyed by mode unit (V/A/Ω/F/°C, %, etc.).
- Continuity/diode special displays.

## 8. Build order (incremental)
1. Scaffold Vite+React+TS+Tailwind+shadcn; tab shell; pokit/uuids+types+codec.
2. connection.ts + statusService + ConnectBar + DeviceInfoView. (verify w/ Sparky)
3. multimeterService + MultimeterView (notifications + readout). (verify)
4. dsoService + OscilloscopeView + Waveform + metrics. (verify)
5. loggerService + LoggerView + CSV export. (verify)
6. Polish, error handling, README with Chromium/Linux setup notes.

## 9. Testing
- Unit tests (vitest) for codec encode/decode against known byte layouts above.
- Manual hardware verification per step with "Sparky".
- No weakening of tests; codec tests are the regression backbone.

## 10. Open risks
- Web Bluetooth on Linux/Chromium reliability (experimental flags).
- DSO Reading packet framing (multiple int16 per notification, reassembly until
  numberOfSamples reached) — validate against hardware.
- Exact DeviceCharacteristics byte offsets — validate firmware version parsing.
