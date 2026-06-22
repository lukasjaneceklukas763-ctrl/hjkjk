MADNESS PROJECT NEXUS CLASSIC – TRUE 2P CO-OP COMPLETE SYNC

Nasazení na GitHub Pages:
1. Nahraj celý obsah této složky do kořene repozitáře.
2. V GitHub Pages nastav větev a kořenovou složku.
3. Po nahrání proveď na obou počítačích tvrdé obnovení Ctrl+F5.
4. Oba hráči musí používat stejnou verzi stránky.

Postup CO-OP:
1. Host vytvoří místnost, druhý hráč se připojí kódem.
2. Oba jsou automaticky posláni do Arena → New Game.
3. Každý zadá vlastní nickname a vytvoří vlastní postavu.
4. BEGIN GAME může stisknout pouze host.
5. Oběma se spustí stejná aréna.

Synchronizace v této verzi:
- dvě samostatné hráčské postavy a obousměrný pohyb/otáčení/útoky
- nickname a aktuální level nad postavou
- samostatný level, XP, peníze, staty a skilly každého hráče
- změna vzhledu/skinů mezi vlnami
- najatí členové týmu obou hráčů se spawnují u obou klientů
- host řídí AI najatých NPC a běžných NPC, hráč 2 dostává jejich stav
- BEGIN GAME je povolen jen hostovi
- lehká host-side ochrana profilu hráče 2 proti skokové změně levelu, peněz, XP a bodů

Lukamer admin:
- admin menu je dostupné pouze při přesném Arena nicku Lukamer
- otevření tlačítkem ADMIN nebo klávesou F2

Poznámka:
Ochrana je lehká a klientská. Bez vlastního autoritativního herního serveru nejde zaručit plnou ochranu proti upravenému klientovi.


Lukamer admin spelly:
- pouze přesný Arena nick Lukamer
- v ADMIN menu vyber Evil-doer, Dr. Christoff nebo Auditor / Phobos · MAGIC
- F6 = SPELL 1 / exploze před postavou
- F7 = SPELL 2 / energetický projektil
- spelly jsou synchronizované oběma klientům
- používají původní herní castSpell a magic efekty
- SQL pro Supabase není potřeba

Technická poznámka k postavám:
- Evil-doer používá vestavěný profil jesus1, který obsahuje původní magic systém.
- Auditor používá dostupný profil phobos a admin hook mu zapne stejný původní magic systém.
