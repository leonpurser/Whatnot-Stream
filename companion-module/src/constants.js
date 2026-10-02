const CUES = [
  { id: 'sold_last', label: 'SOLD (last sale again)' },
  { id: 'item_intro', label: 'NEXT UP (current item)' },
  { id: 'top_buyers', label: 'TOP BUYERS board' },
  { id: 'stats', label: 'SHOW STATS (tonight so far)' },
  { id: 'new_leader', label: 'LEADER (current #1)' },
  { id: 'bidding_war', label: 'BIDDING WAR' },
  { id: 'overtime', label: 'OVERTIME' },
  { id: 'giveaway', label: 'GIVEAWAY TIME' },
  { id: 'chat_clear', label: 'Clear chat bubble' },
  { id: 'clear', label: 'CLEAR ALL graphics' },
];

// Names the overlay reports as "on air".
const ON_AIR_NAMES = [
  { id: 'any', label: 'Anything' },
  { id: 'sold', label: 'SOLD' },
  { id: 'big_sale', label: 'BIG SALE' },
  { id: 'new_record', label: 'NEW RECORD' },
  { id: 'buyer_milestone', label: 'Buyer milestone' },
  { id: 'new_leader', label: 'NEW LEADER' },
  { id: 'show_milestone', label: 'Items-sold milestone' },
  { id: 'top_buyers', label: 'TOP BUYERS' },
  { id: 'stats', label: 'SHOW STATS' },
  { id: 'item_intro', label: 'NEXT UP' },
  { id: 'bidding_war', label: 'BIDDING WAR' },
  { id: 'overtime', label: 'OVERTIME' },
  { id: 'giveaway', label: 'GIVEAWAY' },
  { id: 'giveaway_winner', label: 'Giveaway winner' },
  { id: 'segment', label: 'Segment intro' },
  { id: 'chat', label: 'Chat bubble' },
  { id: 'end_show', label: 'END SHOW recap' },
];

const SETTINGS = [
  { id: 'autoAir.sales', label: 'Auto: SOLD on confident sales', short: 'AUTO\nSOLD' },
  { id: 'trustPriceGuess', label: 'Trust price guess', short: 'TRUST\nPRICE' },
  { id: 'airSalesWithoutPrice', label: 'Air SOLD without price', short: 'SOLD\nNO PRICE' },
  { id: 'autoAir.buyerMilestones', label: 'Auto: buyer milestones', short: 'AUTO\nHAT TRICK' },
  { id: 'autoAir.newLeader', label: 'Auto: NEW LEADER', short: 'AUTO\nLEADER' },
  { id: 'autoAir.showMilestones', label: 'Auto: items-sold milestones', short: 'AUTO\nMILESTONE' },
  { id: 'autoAir.biddingWar', label: 'Auto: BIDDING WAR', short: 'AUTO\nWAR' },
  { id: 'autoAir.overtime', label: 'Auto: OVERTIME', short: 'AUTO\nOVERTIME' },
  { id: 'autoAir.itemIntro', label: 'Auto: NEXT UP on each item', short: 'AUTO\nNEXT UP' },
  { id: 'autoAir.giveawayWinner', label: 'Auto: giveaway winner', short: 'AUTO\nGIVEAWAY' },
];

const TEST_KINDS = [
  { id: 'sale', label: 'Sale' },
  { id: 'big', label: 'Big sale' },
  { id: 'record', label: 'Record sale' },
  { id: 'hattrick', label: 'Hat trick (3 sales)' },
  { id: 'lowconf', label: 'Unsure sale (needs review)' },
  { id: 'start', label: 'New auction' },
  { id: 'bid', label: 'Bid' },
  { id: 'war', label: 'Bidding war' },
  { id: 'extend', label: 'Extend / overtime' },
  { id: 'giveaway', label: 'Giveaway win' },
  { id: 'chat', label: 'Chat message' },
];

function getSetting(settings, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), settings || {});
}

module.exports = { CUES, ON_AIR_NAMES, SETTINGS, TEST_KINDS, getSetting };
