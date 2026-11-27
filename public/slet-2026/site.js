const search = document.querySelector('#track-search');
const filters = [...document.querySelectorAll('[data-filter]')];
const tracks = [...document.querySelectorAll('[data-track]')];
const empty = document.querySelector('#track-empty');
let floor = 'all';

function normalize(value) {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim();
}

function update() {
  const query = normalize(search.value);
  let count = 0;
  for (const track of tracks) {
    const codeMatch = /^0?\d$/.test(query) && Number(query) === Number(track.dataset.track);
    const searchMatch = codeMatch || normalize(track.dataset.search).includes(query);
    track.hidden = !((floor === 'all' || floor === track.dataset.floor) && searchMatch);
    count += Number(!track.hidden);
  }
  empty.hidden = count !== 0;
}

search.addEventListener('input', update);
for (const filter of filters) {
  filter.addEventListener('click', () => {
    floor = filter.dataset.filter;
    for (const item of filters) item.setAttribute('aria-pressed', String(item === filter));
    update();
  });
}

const selected = tracks.find(track => `#p${track.dataset.track}` === location.hash);
if (selected) selected.open = true;
document.querySelector('#track-tools').hidden = false;
