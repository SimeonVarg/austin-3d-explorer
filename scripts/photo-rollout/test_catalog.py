import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from accept import Rejected
import catalog


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'sources'
        self.walk = self.root / '_walks' / 'walk'
        (self.walk / 'thumbs').mkdir(parents=True)
        (self.walk / 'full').mkdir()
        self.index = self.base / 'index'
        self.index.mkdir()
        self.out = self.base / 'catalog.json'
        for name, color in [('a', 'red'), ('b', 'blue')]:
            Image.new('RGB', (40, 30), color).save(self.walk / 'thumbs' / (name+'.jpg'))
        (self.walk / 'full/a.jpg').write_bytes((self.walk / 'thumbs/a.jpg').read_bytes())
        rows = [dict(photo_id='a', sha256='original-a', lat=None, lon=None),
                dict(photo_id='b', sha256='original-b', lat=1, lon=2)]
        (self.walk / 'photos.jsonl').write_text('\n'.join(json.dumps(r) for r in rows))
        (self.index / 'confirmed.json').write_text(json.dumps({'a': {'is':'building'}}))

    def run_build(self):
        return catalog.build(self.root, self.index, self.out)

    def plan(self, **change):
        rows = [dict(file=str(self.walk/'thumbs/a.jpg'), reviewed=True, role='build',
                     viewpoint_group='front', categories=['building','ground','decoration']),
                dict(file=str(self.walk/'thumbs/b.jpg'), reviewed=True, role='holdout',
                     viewpoint_group='side', categories=['building'])]
        rows[1].update(change)
        p = self.base / 'plan.json'
        p.write_text(json.dumps({'views':rows}))
        return p

    def test_missing_gps_and_duplicate_derivatives_retained(self):
        result = self.run_build()
        self.assertEqual(result['summary']['image_files'], 3)
        self.assertEqual(result['summary']['exact_duplicate_copies'], 1)
        self.assertEqual(result['summary']['walk_missing_location'], 1)
        self.assertEqual(result['summary']['walk_visual_confirmations'], 1)
        self.assertEqual(len(result['records'][0]['files']), 2)
        self.assertEqual(result['records'][0]['candidates'], [])

    def test_missing_source_and_unassigned_image_are_visible(self):
        d = self.root/'hall'; d.mkdir()
        (d/'sources.json').write_text(json.dumps([{'file':'missing.jpg','date':'unknown'}]))
        Image.new('RGB',(5,5)).save(d/'unknown.jpg')
        result = self.run_build()
        self.assertEqual(result['summary']['records_without_images'], 1)
        self.assertEqual(result['summary']['unassigned_images'], 1)
        self.assertEqual(result['summary']['missing_declared_images'], 1)

    def test_manifest_cannot_expand_source_root(self):
        d=self.root/'hall';d.mkdir()
        (d/'sources.json').write_text(json.dumps([{'file':'../../outside.jpg'}]))
        with self.assertRaises(Rejected):self.run_build()

    def test_nonimage_source_is_not_a_missing_photo(self):
        d=self.root/'hall';d.mkdir()
        (d/'sources.json').write_text(json.dumps([{'data_url':'https://example.test/survey'}]))
        result=self.run_build()
        self.assertEqual(result['summary']['missing_declared_images'],0)
        self.assertEqual(result['summary']['non_image_source_records'],1)

    def test_symlinked_thumbnail_keeps_its_walk_identity(self):
        target=self.base/'external.jpg'
        (self.walk/'thumbs/a.jpg').rename(target)
        (self.walk/'thumbs/a.jpg').symlink_to(target)
        result=self.run_build()
        self.assertEqual(len(result['records'][0]['files']),2)
        catalog.packet(self.out,self.plan(),self.base/'packet')

    def test_packet_uses_reviewed_images_and_drops_metadata(self):
        self.run_build()
        result = catalog.packet(self.out, self.plan(), self.base/'packet')
        self.assertEqual(len(result['views']),2)
        with Image.open(result['views'][0]['input']['file']) as image:
            self.assertFalse(image.getexif())
        with self.assertRaises(Rejected):
            catalog.packet(self.out,self.plan(),self.base/'packet')

    def test_unreviewed_and_invalid_crop_rejected(self):
        self.run_build()
        for change in [{'reviewed':False},{'crop':[0,0,500,20]}]:
            with self.assertRaises(Rejected):
                catalog.packet(self.out,self.plan(**change),self.base/'packet')
        self.assertFalse((self.base/'packet').exists())

    def test_same_viewpoint_and_known_original_cannot_leak_into_holdout(self):
        self.run_build()
        for change in [{'viewpoint_group':'front'}, {'file':str(self.walk/'full/a.jpg')}]:
            with self.assertRaises(Rejected):
                catalog.packet(self.out,self.plan(**change),self.base/'packet')

    def test_changed_source_rejected(self):
        self.run_build()
        Image.new('RGB',(40,30),'green').save(self.walk/'thumbs/a.jpg')
        with self.assertRaises(Rejected):
            catalog.packet(self.out,self.plan(),self.base/'packet')

    def test_output_cannot_be_git_or_source_tree(self):
        with self.assertRaises(Rejected):
            catalog.build(self.root,self.index,self.root/'catalog.json')
        (self.base/'.git').write_text('gitdir: nowhere')
        with self.assertRaises(Rejected): self.run_build()

    def test_invalid_metadata_is_not_silently_omitted(self):
        (self.walk/'photos.jsonl').write_text('{wrong')
        with self.assertRaises(Rejected): self.run_build()

    def test_external_metadata_and_source_aliases_are_preserved(self):
        import os
        index = self.index/'index.jsonl'; index.write_text('{"id":"a","hits":[]}\n')
        targets = [index, self.index/'confirmed.json']
        for source in (self.walk/'thumbs/a.jpg', self.walk/'photos.jsonl'):
            target = self.base/(source.name+'.alias'); os.link(source, target); targets.append(target)
        external = self.base/'external.jpg'
        Image.new('RGB', (5,5), 'green').save(external)
        (self.walk/'thumbs/external.jpg').symlink_to(external); targets.append(external)
        for target in targets:
            before = target.read_bytes()
            with self.subTest(target=target.name), self.assertRaisesRegex(Rejected, 'must not overwrite'):
                catalog.build(self.root, self.index, target)
            self.assertEqual(target.read_bytes(), before)
        self.out.write_text('unrelated previous output')
        self.run_build()
        self.assertEqual(json.loads(self.out.read_text())['kind'], 'private-photo-catalog')

    def test_packet_nonempty_alias_destination_preserves_evidence(self):
        self.run_build(); plan = self.plan(); output = self.base/'packet'; output.mkdir()
        photo = self.walk/'thumbs/a.jpg'; before = photo.read_bytes()
        (output/'build-01.jpg').symlink_to(photo)
        with self.assertRaisesRegex(Rejected, 'must be empty'):
            catalog.packet(self.out, plan, output)
        self.assertEqual(photo.read_bytes(), before)


if __name__ == '__main__': unittest.main()
