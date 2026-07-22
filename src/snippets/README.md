# zzeelisp

A utility library of 120+ functions for [EELisp](https://github.com/santacroce-tech/eeditor), organized into 10 themed modules. Inspired by [Funcoes ZZ](https://funcoeszz.net).

## Modules

| Module | Description |
|--------|-------------|
| `zz-text` | String manipulation, alignment, word count |
| `zz-math` | Primes, factorials, base conversion, BMI |
| `zz-date` | Easter, carnival, business days, stardates |
| `zz-convert` | Bytes, temperatures, distances, URL encoding |
| `zz-crypto` | Password gen, ROT13, Caesar, Vigenere |
| `zz-fun` | Dice, coin flip, random names, dev excuses |
| `zz-reference` | NATO alphabet, Morse, periodic table, ports |
| `zz-network` | Subnet calc, geo-IP, IP validation |
| `zz-timeat` | World clock, timezone conversion (100+ cities) |
| `zz-bitcoin` | Price, hashrate, halving, fee calc, node RPC |

## Usage

```lisp
(load "zz-text.eelisp")
(load "zz-bitcoin.eelisp")

(zzromanos 2024)          ; → "MMXXIV"
(zzconverte 100 :c :f)    ; → 212.0
(zzbtc-price)             ; → {:usd 45000 :source "mempool.space"}
(timeat "tokyo" "now")    ; → "02:30 JST (UTC+9)"
```

## Help

```lisp
(zzajuda)              ; full index
(zzajuda :bitcoin)     ; filter by module
(zzzz "zzbtc-price")   ; details for one function
```

## Integration

zzeelisp is used by:

- [EEPilot](https://github.com/santacroce-tech/eepilot) - AI coding assistant for EEditor
- [EEditor](https://github.com/santacroce-tech/eeditor) - macOS text editor with EELisp runtime

## License

MIT
