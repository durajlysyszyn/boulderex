# Aplikacja do baldów (robocza nazwa: Rozkmina)

Społecznościowa aplikacja mobilna (iOS i Android) dla wspinaczy bulderowych. Każdy może zostać routesetterem: robi zdjęcie ścianki, zaznacza chwyty i publikuje balda. Inni przychodzą na tę samą ściankę, próbują go zrobić i dzielą się przejściami.

Pełny plan (funkcje, etapy, model danych, ryzyka) jest w dokumencie „Aplikacja do baldów – plan wdrożenia”. Ten plik streszcza to, co jest potrzebne do pisania kodu.

## Technologia

- Aplikacja: React Native + Expo (TypeScript), jeden kod na iOS i Androida.
- Rysowanie zdjęcia i obrysów chwytów: `@shopify/react-native-skia`.
- Backend: Supabase (PostgreSQL + PostGIS, Auth, Storage, Edge Functions).
- Logowanie: Google, Apple, Facebook (Supabase Auth). Sign in with Apple jest wymagane przez App Store (wytyczna 4.8), skoro jest logowanie Google/Facebook.
- Widoczność baldów egzekwowana w bazie przez Row Level Security, nie tylko w aplikacji.
- Wideo: zewnętrzna usługa (Mux lub Cloudflare Stream), w bazie tylko odnośnik. Limit ok. 60 s.
- Push: Expo Notifications.
- Testowanie na telefonie: Expo Go / development build, buildy do sklepów przez EAS Build.

## Decyzje produktowe (wiążące)

- **Bald zawsze należy do ścianki.** Bez wybranej ścianki nie da się go opublikować.
- **Formacje istnieją tylko na ściankach z oficjalnym profilem** (nazwy nadaje obiekt). Na ściance bez profilu bald nie ma pola formacji (`formation_id` opcjonalne).
- **Ścianka istnieje w katalogu niezależnie od profilu.** Użytkownicy mogą ją dodać; obiekt może później przejąć profil, nazwać formacje i dodać harmonogram przekrętek.
- **Każda ścianka ma własną skalę trudności** (kolory, cyfry, Font/V). Każdy stopień ma przybliżony odpowiednik Font do sortowania.
- **Znajomi = osoby, które obserwuję** (obserwacja jednostronna). Widoczność „Znajomi” = osoby, które obserwuje autor.
- **Grupy** tworzy się osobno; zaproszeni muszą zaakceptować dołączenie. Role: właściciel, admin, członek.
- **Grupa nie tworzy baldów.** Bald ma zawsze jednego autora, który może opublikować go w grupie.
- **Widoczność balda:** Tylko ja, Znajomi, Wybrane grupy, Publiczne.
- **Bety są zakryte** (filmy, zdjęcia, wskazówki rozmyte) i odsłaniają się tylko po świadomej akcji („Pokaż bety”), także po oznaczeniu przejścia.
- **Pytania do autora są jawne, odpowiedzi zakryte.** Wyjątek: odpowiedź oznaczona przez autora jako zasada (np. „paczka dozwolona”) jest jawna i trafia do zasad balda. Pytający może zakryć pytanie, jeśli zdradza rozwiązanie.
- **Przekrętki:** jeśli ścianka ma harmonogram, przy baldzie widać, ile czasu zostało; po przekrętce bald idzie do archiwum.
- **Typy chwytów:** start, ręka, stopa, top. Kontur zapisywany jako wielokąt we współrzędnych zdjęcia (nie bitmapa). Zaznaczenie automatyczne (tapnięcie) albo ręczne (obrys palcem).
- **Moderacja od MVP:** zgłaszanie treści i użytkowników, blokowanie, panel moderacji (wytyczna App Store 1.2).
- **Usunięcie konta** w aplikacji i przez stronę www (Google Play, App Store).

## Prototyp zaznaczania chwytów

Plik `prototyp-chwyty.html` to działający prototyp webowy (canvas). Algorytm jest do przeniesienia do aplikacji prawie bez zmian:

- obraz skalowany do maks. 1400 px, konwersja do Lab + rozmycie 3×3,
- `geodesic(x, y)`: mapa odległości geodezyjnej (Dijkstra) od tapnięcia; koszt kroku = różnica koloru ponad poziom szumu,
- `autoT(g)`: automatyczny próg – pierwsze plateau obszaru albo moment tuż przed „wybuchem”; preferuje mniejszy obiekt (chwyt, nie paczkę); pomija otwory po śrubach,
- `segment(x, y)`: wybór ziarna, z pierścieniem kandydatów gdy tapnięcie trafi w śrubę/otwór,
- domknięcie morfologiczne, wypełnienie dziur, śledzenie brzegu, wygładzenie do krzywej,
- tryb ręczny: obrys palcem → wygładzony wielokąt.

W aplikacji algorytm ma działać na telefonie (offline), najlepiej poza wątkiem UI.

## Etapy

0. **Prototyp i walidacja (4–6 tyg.)** – edytor chwytów na telefonie, publikacja jednego balda, testy z 10–20 wspinaczami na Obiekto (Warszawa).
1. **MVP społecznościowe (3–4 mies.)** – konta Google/Apple/Facebook, profil, obserwowanie, katalog ścianek z mapą, edytor, publikacja, feed, przejścia (flash/zrobiony/projekt), komentarze z zakrytymi betami, moderacja, push, szkice offline.
2. **Grupy (ok. 2 mies.)** – grupy z zaproszeniami, publikacja w grupie, wycena z konsensusu, zgłaszanie przekrętek.
3. **Profile ścianek (2–3 mies.)** – przejęcie profilu, panel webowy (Next.js), formacje, harmonogram przekrętek, archiwum.
4. **Treści ścianek** – aktualności, wydarzenia, zawody.
5. **Inteligencja** – model AI wykrywający wszystkie chwyty, rozpoznawanie formacji.

Pilotaż: Obiekto, Warszawa (formacje: Comp Wall, Spraywall, Pion, Zetka, Zietka, 45, Dach, Trójkąt, 18, Slab).

## Główne tabele (PostgreSQL)

users, follows, blocks, gyms (status: społecznościowa / zweryfikowana, lokalizacja PostGIS), gym_admins, formations, grade_scales, grades, boulders (autor, gym, formation opcjonalnie, grade, widoczność, status: szkic/aktywny/archiwum, ważny_do), boulder_photos, boulder_holds (typ, wielokąt, auto/ręczny), boulder_rules, boulder_groups, ascents, comments (rodzaj, beta, zasada, odpowiedź_do), media, groups, group_members (rola, status: zaproszony/aktywny), reset_schedules, gym_posts, reports, notifications.

## Zasady pracy

- Język interfejsu: polski (przygotować pod tłumaczenia).
- Małe kroki: jedna funkcja na raz, po każdej działający build w Expo Go.
- Każda zmiana bazy jako migracja Supabase; reguły RLS z testami (kto widzi prywatnego / znajomego / grupowego balda).
- Nie przechowywać sekretów w repozytorium (`.env` w `.gitignore`).
