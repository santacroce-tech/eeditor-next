; step1.asm — the MSX tutorial (docs/msx/TUTORIAL.md), step 1: a cartridge that says hello.
;
;   npm run msx:asm -- docs/msx/snake/step1.asm      makes docs/msx/snake/step1.rom

; The BIOS: routines in the MSX's ROM that every cartridge can call
CHGCLR   equ 0x0062     ; set the screen's colours from FORCLR, BAKCLR and BDRCLR
INIT32   equ 0x006F     ; SCREEN 1: 32×24 tiles of 8×8 pixels
FORCLR   equ 0xF3E9     ; the BIOS's colours: text,
BAKCLR   equ 0xF3EA     ; background,
BDRCLR   equ 0xF3EB     ; and border

; The video chip
VDP_DATA equ 0x98       ; read or write video memory, the address moving on each time
VDP_CTRL equ 0x99       ; set that address (two bytes, low first)
NAMES    equ 0x1800     ; in SCREEN 1, 32×24 bytes: the tile on each cell of the screen

; The cartridge's header: the BIOS looks for "AB" at 0x4000 and calls the address after it
         org 0x4000
         db "AB"
         dw start
         ds 12                  ; the rest of the header: unused

start:   ld a,15                ; white letters
         ld (FORCLR),a
         ld a,4                 ; on dark blue, and a dark blue border
         ld (BAKCLR),a
         ld (BDRCLR),a
         call CHGCLR
         call INIT32            ; SCREEN 1, the font loaded, the screen cleared

         ld hl,hello
         ld de,11*32 + 10       ; row 11, column 10
         call print

forever: ei
         halt                   ; nothing more to do: wait for the next frame, for ever
         jr forever

; The text at HL (ending in 0) on the screen from cell DE.
print:   push hl
         ex de,hl
         ld a,h                 ; the cell's address in video memory: NAMES + DE
         add a,HIGH(NAMES)
         ld h,a
         call setwrite
         pop hl
.next    ld a,(hl)
         or a
         ret z                  ; the 0 at the end
         out (VDP_DATA),a       ; a letter on the screen
         inc hl
         jr .next

; Point the video chip at address HL, to write there. The two bytes go with interrupts off:
; the BIOS's frame interrupt talks to the chip too.
setwrite:
         di
         ld a,l
         out (VDP_CTRL),a
         ld a,h
         or 0x40                ; 01 in the top bits: for writing
         out (VDP_CTRL),a
         ei
         ret

hello:   db "Hello, MSX!", 0

         ds 0x8000 - $, 0xFF    ; fill the cartridge out to 16 KB
