// Teksty interfejsu w jednym miejscu – przygotowanie pod tłumaczenia.
export const pl = {
  photo: {
    title: 'Nowy bald',
    subtitle: 'Wybierz zdjęcie ścianki, na którym zaznaczysz chwyty.',
    pickFromGallery: 'Wybierz z galerii',
    changePhoto: 'Zmień zdjęcie',
    fitView: 'Dopasuj widok',
    preparing: 'Przygotowuję zdjęcie…',
    pickError: 'Nie udało się wczytać zdjęcia. Spróbuj ponownie.',
    replaceTitle: 'Nowe zdjęcie?',
    replaceText: 'Zaznaczone chwyty zostaną usunięte.',
    replace: 'Zastąp',
    cancel: 'Anuluj',
  },
  editor: {
    analyzing: 'Analizuję zdjęcie…',
    hint: 'Tapnij chwyt – kontur dobierze się sam',
    noEdge: 'Nie widzę tu krawędzi chwytu – przybliż i spróbuj jeszcze raz',
    undo: 'Cofnij',
    clear: 'Wyczyść',
    gallery: 'Galeria',
    fit: 'Dopasuj',
    holdTypes: {
      start: 'Start',
      hand: 'Ręka',
      foot: 'Stopa',
      top: 'Top',
    },
  },
} as const;

export const t = pl;
