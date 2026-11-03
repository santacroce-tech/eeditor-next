; step3.asm — the MSX tutorial (docs/msx/TUTORIAL.md), step 3: the snake — moving, steering, crashing.
;
;   npm run msx:asm -- docs/msx/snake/step3.asm      makes docs/msx/snake/step3.rom (in the repository)
;   node z80asm.mjs step3.asm                        the same, with the assembler from eeditor.app

; ---------------------------------------------------------------------------
; The BIOS: routines in the MSX's ROM that every cartridge can call
; ---------------------------------------------------------------------------
CHGCLR   equ 0x0062     ; set the screen's colours from FORCLR, BAKCLR and BDRCLR
FILVRM   equ 0x0056     ; fill BC bytes of video memory from HL with A
LDIRVM   equ 0x005C     ; copy BC bytes from HL in memory to DE in video memory
INIT32   equ 0x006F     ; SCREEN 1: 32×24 tiles of 8×8 pixels
WRTPSG   equ 0x0093     ; write E into sound-chip register A
GTSTCK   equ 0x00D5     ; with A=0: the cursor keys, as a direction 0–8
GTTRIG   equ 0x00D8     ; with A=0: the space bar — 0xFF while it's held, else 0

FORCLR   equ 0xF3E9     ; the BIOS's colours: text,
BAKCLR   equ 0xF3EA     ; background,
BDRCLR   equ 0xF3EB     ; and border

; ---------------------------------------------------------------------------
; The video chip, in SCREEN 1
; ---------------------------------------------------------------------------
VDP_DATA equ 0x98       ; read or write video memory, the address moving on each time
VDP_CTRL equ 0x99       ; set that address (two bytes, low first)
PATTERNS equ 0x0000     ; 256 tiles × 8 bytes: each byte a row of 8 pixels
NAMES    equ 0x1800     ; 32×24 bytes: the tile on each cell of the screen
COLOURS  equ 0x2000     ; 32 bytes: the colours of each group of 8 tiles (ink × 16 + paper)

; our tiles: the letters' tiles are the font; these four are drawn below, each the first of
; a group of eight so that each can have its own colours
EMPTY    equ ' '
WALL     equ 0x80
BODY     equ 0x88
HEAD     equ 0x90
APPLE    equ 0x98

; ---------------------------------------------------------------------------
; Our variables, in RAM
; ---------------------------------------------------------------------------
RING     equ 0xE000     ; the snake: 256 cells of 2 bytes, a ring — the head at HEADI,
HEADI    equ 0xE200     ;   the tail at TAILI; each index wraps from 255 to 0
TAILI    equ 0xE201
DIR      equ 0xE202     ; 2 bytes: what to add to a cell to go a step (1, -1, 32 or -32)
WANT     equ 0xE204     ; 2 bytes: the direction the keys asked for
GROW     equ 0xE206     ; how many more steps the tail stays put
TIMER    equ 0xE207     ; frames to the next step
SPEED    equ 0xE208     ; frames between steps
EATEN    equ 0xE209     ; apples since the last speed-up
SCORE    equ 0xE20A     ; 2 bytes, 4 decimal digits (BCD: a digit a nibble)
HISCORE  equ 0xE20C     ; 2 bytes, the same
SEED     equ 0xE20E     ; 2 bytes, for the random numbers

; ---------------------------------------------------------------------------
; The cartridge's header: the BIOS looks for "AB" at 0x4000 and calls the address after it
; ---------------------------------------------------------------------------
         org 0x4000
         db "AB"
         dw start
         ds 12                  ; the rest of the header: unused

start:   ld a,15                ; white letters
         ld (FORCLR),a
         ld a,1                 ; on black, black border
         ld (BAKCLR),a
         ld (BDRCLR),a
         call CHGCLR
         call INIT32            ; SCREEN 1, the font loaded

         ; our four tiles' pixels, each at the start of its group of eight
         ld hl,tiles
         ld de,PATTERNS + WALL*8
         ld b,4
.tile    push bc
         push hl
         push de
         ld bc,8
         call LDIRVM
         pop hl                 ; the video address…
         ld bc,8*8
         add hl,bc              ; …eight tiles on
         ex de,hl
         pop hl                 ; the pixels…
         ld bc,8
         add hl,bc              ; …the next tile's
         pop bc
         djnz .tile

         ; and their colours: groups 16 to 19
         ld hl,colours
         ld de,COLOURS + WALL/8
         ld bc,4
         call LDIRVM

         ld hl,0                ; the best score stays 0000 until step 5
         ld (HISCORE),hl

; ---------------------------------------------------------------------------
; A game
; ---------------------------------------------------------------------------
newgame: ld hl,0
         ld (SCORE),hl
         call field

         ; the snake: four cells in the middle row, the head on the right
         xor a
         ld (TAILI),a
         ld a,3
         ld (HEADI),a
         ld hl,12*32 + 8
         ld ix,RING
         ld b,4
.body    ld (ix+0),l
         ld (ix+1),h
         ld a,BODY
         call put
         inc hl
         inc ix
         inc ix
         djnz .body
         dec hl
         ld a,HEAD
         call put

         ld hl,1                ; going right
         ld (DIR),hl
         ld (WANT),hl
         ld a,8
         ld (SPEED),a
         ld (TIMER),a

play:    ei
         halt                   ; wait for the next frame: 60 a second
         call steer
         ld hl,TIMER
         dec (hl)
         jr nz,play             ; not time to move yet
         ld a,(SPEED)
         ld (TIMER),a
         call step
         jr nc,play             ; no carry: still alive

         ; crashed
         ld hl,txt_over
         ld de,11*32 + 11
         call print
.end     ei
         halt
         jr .end

; The cursor keys: remember the direction they point, for the next step.
steer:   xor a
         call GTSTCK            ; 1 up, 3 right, 5 down, 7 left (2, 4, 6, 8 diagonals)
         ld hl,-32
         cp 1
         jr z,.want
         ld hl,1
         cp 3
         jr z,.want
         ld hl,32
         cp 5
         jr z,.want
         ld hl,-1
         cp 7
         ret nz
.want    ld (WANT),hl
         ret

; One step of the snake. Carry set: it crashed.
step:    ld hl,(WANT)           ; turn — unless it means going straight back
         ld de,(DIR)
         add hl,de              ; a direction and its opposite add up to 0
         ld a,h
         or l
         jr z,.ahead
         ld hl,(WANT)
         ld (DIR),hl

.ahead   ld a,(HEADI)           ; the head's cell
         call ringat
         ld e,(hl)
         inc hl
         ld d,(hl)
         ex de,hl
         ld a,BODY              ; becomes body
         call put
         ld de,(DIR)
         add hl,de              ; the next cell
         call get
         cp EMPTY
         jr z,.move
         or a                   ; a wall, or itself: crashed
         sbc hl,de              ; back to where the head was
         ld a,HEAD
         call put
         scf
         ret

.move    ld a,HEAD
         call put
         ex de,hl               ; DE: the new head's cell
         ld a,(HEADI)
         inc a
         ld (HEADI),a
         call ringat
         ld (hl),e
         inc hl
         ld (hl),d

         ld a,(TAILI)           ; the tail moves up a cell
         call ringat
         ld e,(hl)
         inc hl
         ld d,(hl)
         ex de,hl
         ld a,EMPTY
         call put
         ld hl,TAILI
         inc (hl)
         or a                   ; carry clear: alive
         ret

; ---------------------------------------------------------------------------
; The screen
; ---------------------------------------------------------------------------

; The playing field: the score line, a wall round the rest.
field:   ld hl,NAMES
         ld bc,32*24
         ld a,EMPTY
         call FILVRM
         ld hl,NAMES + 1*32     ; the top wall
         ld bc,32
         ld a,WALL
         call FILVRM
         ld hl,NAMES + 23*32    ; the bottom wall
         ld bc,32
         ld a,WALL
         call FILVRM
         ld hl,2*32             ; the sides, rows 2 to 22
         ld b,21
         ld de,31
.side    ld a,WALL
         call put               ; the left…
         add hl,de
         call put               ; …and the right
         inc hl
         djnz .side
         ld hl,txt_score
         ld de,1
         call print
         ld hl,txt_hi
         ld de,24
         call print
         ; and on into showscore

; The score and the best, from their BCD.
showscore:
         ld hl,7
         ld de,SCORE
         call bcd
         ld hl,27
         ld de,HISCORE
         ; and on into bcd

; The four digits of the BCD number at DE, at cell HL.
bcd:     ld a,h
         add a,HIGH(NAMES)
         ld h,a
         call setwrite
         inc de                 ; the high byte first: the thousands and hundreds
         ld a,(de)
         call .two
         dec de
         ld a,(de)              ; then the tens and units
.two     push af
         rrca
         rrca
         rrca
         rrca
         and 15
         add a,'0'
         out (VDP_DATA),a
         pop af
         and 15
         add a,'0'
         out (VDP_DATA),a
         ret

; The text at HL (ending in 0) on the screen from cell DE.
print:   push hl
         ex de,hl
         ld a,h
         add a,HIGH(NAMES)
         ld h,a
         call setwrite
         pop hl
.next    ld a,(hl)
         or a
         ret z
         out (VDP_DATA),a
         inc hl
         jr .next

; Tile A on cell HL (0–767). Keeps every register.
put:     push hl
         push af
         ld a,h
         add a,HIGH(NAMES)
         ld h,a
         call setwrite
         pop af
         out (VDP_DATA),a
         pop hl
         ret

; The tile on cell HL into A. Keeps the other registers.
get:     push hl
         ld a,h
         add a,HIGH(NAMES)
         ld h,a
         call setread
         pop hl
         in a,(VDP_DATA)
         ret

; Point the video chip at address HL, to write there (setwrite) or read (setread). The two
; bytes go with interrupts off: the BIOS's frame interrupt talks to the chip too.
setwrite:
         ld a,h
         or 0x40                ; 01 in the top bits: for writing
         jr setaddr
setread: ld a,h
         and 0x3F               ; 00: for reading
setaddr: di
         push af
         ld a,l
         out (VDP_CTRL),a
         pop af
         out (VDP_CTRL),a
         ei
         ret

; ---------------------------------------------------------------------------
; Odds and ends
; ---------------------------------------------------------------------------

; HL: the entry for index A in the ring. Keeps DE.
ringat:  push de
         ld l,a
         ld h,0
         add hl,hl
         ld de,RING
         add hl,de
         pop de
         ret

; ---------------------------------------------------------------------------
; Data
; ---------------------------------------------------------------------------
tiles:   db 0b11101111          ; the wall: bricks
         db 0b11101111
         db 0b11101111
         db 0b00000000
         db 0b11111110
         db 0b11111110
         db 0b11111110
         db 0b00000000

         db 0b00111100          ; the body: a round segment
         db 0b01111110
         db 0b11111111
         db 0b11111111
         db 0b11111111
         db 0b11111111
         db 0b01111110
         db 0b00111100

         db 0b00111100          ; the head: with eyes
         db 0b01111110
         db 0b11011011
         db 0b11011011
         db 0b11111111
         db 0b11111111
         db 0b01111110
         db 0b00111100

         db 0b00001000          ; an apple
         db 0b00010000
         db 0b01101100
         db 0b11111110
         db 0b11111110
         db 0b11111110
         db 0b01111100
         db 0b00101000

colours: db 0x6E                ; wall: dark red bricks, grey mortar
         db 0x21                ; body: green on black
         db 0x31                ; head: light green
         db 0x81                ; apple: red

txt_over:  db "GAME  OVER", 0
txt_score: db "SCORE", 0
txt_hi:    db "HI", 0

         ds 0x8000 - $, 0xFF    ; fill the cartridge out to 16 KB
